Migrating Runn to the Hasura GraphQL Engine
===========================================

The Problem
-----------

When Runn first launched, it was designed for small and medium-sized companies
to help plan their projects. We strived to make Runn as fast as possible while
also providing plenty of useful features.

But it didn't take long for large companies to become interested in Runn,
bringing along hundreds of people and projects to manage. We started to notice
performance issues, navigating the app was no longer instant.

Improving the performance of a web app is rarely as simple as just fixing one
thing, it typically involves optimizing every part of the system. We spent many
hours optimizing our database, server and front-end client, but we felt that
major changes would be needed to achieve high performance for these large
accounts.

The bottleneck of the system was our GraphQL API, it was just really slow to
respond to large queries. Our API server was written in Ruby using Rails and
reads data from a PostgreSQL database.

A typical account will fetch a few hundred kilobytes of data from the server,
which isn't that much, but it would take our Rails server several seconds to
respond. 

We reasoned that this was because of the way Rails would fetch data. For each
request, Rails would make many separate queries to the database and then
need to parse and format this data into the appropriate structure.

We tried to fetch all the data directly from the database in a single query. The
data was returned in a fraction of the time! This told us that there was plenty
of room for performance improvements and that the Rails GraphQL server was the
bottleneck.

Our team was lacking an experienced Rails developer. We had done our best to
optimize Rails performance, but we felt any further improvements would require
radical changes. We began searching for an alternative solution.

Our Proposed Solution
---------------------

We were specifically looking for a fast and efficient GraphQL server. 

We considered rewriting the GraphQL Server in Node.js with Apollo Server, but
we knew that this would be a lot of work. We would need to make sure our SQL
queries were as efficient as possible to minimise overhead when resolving large
queries, as well as handling exceptions and making sure the whole thing was
secure.

We soon discovered [Hasura](https://hasura.io/), which is an open-source
GraphQL engine. It automatically generates a ready-to-use GraphQL API based on
the schema of your database and uses advanced techniques to resolve queries as
quickly as possible. It does require that your database schema is aligned
closely with your API. Fortunately, our database already was.

From our initial testing, it was clear that Hasura was extremely fast. Behind
the scenes, it would convert each GraphQL request into just a single SQL query,
minimising overhead and getting that raw database performance we knew was
there.

[PostGraphile](https://www.graphile.org/) is a popular alternative to Hasura,
with many similar features. One serious benefit of using Postgraphile was that
it was written in JavaScript (Hasura is written in Haskell) and would be a lot
easier for us to contribute to.  PostGraphile makes good use of native
PostgreSQL functions, while Hasura encourages the use of webhooks to implement
custom mutations. 

We performed a few benchmark tests, which showed that Hasura was extremely
fast, making our Rails server look sluggish in comparison. We also
found that Hasura had a slight performance edge over PostGraphile. 

Hasura's support for webhooks would also allow us to integrate it with our
existing Ruby on Rails server and reuse the business logic for custom mutations
(where performance isn't as much of a concern).

We were convinced that switching to Hasura was a sensible choice and would
bring big performance improvements to the app.

The Migration
-------------

How we made the switch to Hasura.

We didn't want to migrate all of Run to Hasura in just a single step. We knew
the migration would involve making _many, many_ changes, taking months of work.
All these changes would likely conflict with other features being developed in
parallel, which would slow us down further. It also increased the risk of bugs
as the entire app would need to be thoroughly tested.

Instead, we opted to migrate to Hasura in multiple steps. This allowed us to
release in smaller chunks, that were easier to test.

Our plan changed over time, but it went roughly like this:

### 1. Standing up a Hasura server in production

This involved updating our CI/CD config to support Hasura.

We are running on Heroku, which you can deploy Hasura to, but many of
Herouku's features aren't supported in container mode, so a lot of our time was
spent replicating the Pipeline Review App feature so each Pull Request on
Github would get a dedicated test environment, complete with database and Hasura
instance.

The Hasura config is read from a metadata folder stored in our Git repo. This
means we can version control any changes we make to Hasura, test them before
merging the PR and be sure that production will be in the same state.

This means in step 1, we already have Hasura running in production! However,
it's just sitting there idle, no requests are being made to it just yet.

### 2. Configuring Relay to support two GraphQL APIs

We are using Relay in the front-end app. Like most GraphQL clients, it assumes
you have a single GraphQL API that you plan to query.

During the migration, our app would be querying from two different APIs.  Relay
comes with a compiler that validates your GraphQL queries against a remote
schema and generates typescript files. For this to work, the compiler needs to
know which schema to use. We needed to configure our project to use two
different configs for the Relay Compiler. We found that the relay compiler
could be configured to include/exclude certain folders based on a pattern.

This allows to continue compiling the app for the existing Rails API, but
migrate a single page to Hasura and still get full schema validation and type
checking.

### 3. Customising Hasura to fit our needs

We are using Relay in the front-end client. Hasura provides a special endpoint,
specifically for Relay, but it doesn't currently support Actions, so we are
using the standard GraphQL endpoint instead.

Making good use of Computed Fields.

- get the current user
- get the Relay global ID for an item

users → all users on the account
users_viewer →  currently authenticated user

### 4. Creating the Actions we need

The idea of not having to write our GraphQL server also appealed to us. Hasura
provides query resolves for each table along with mutations to insert, update
and delete rows.

Our Rails GraphQL API has several mutations that don't easily map to the
built-in Hasura mutations.

For example, we have a mutation to bulk update a list of assignments. It
handles merging assignments, deleting assignments, creating new
assignments.

It would be possible to update our front-end to call multiple GraphQL
mutations, but this would be complicated and require multiple round trips as we
wait for the Hasura t

### 5. Migrating a page at a time

updating queries, mutations

During the migration, We effectively had two Relay stores, each with a cache
running in parallel.
Sometimes we would need to mutate data that is in both stores and that required
manually updating the cache.

### 6. Migrating real-time sync 

> Live queries aren't weren't what we wanted
> had to create an audit log table to sync data update between clients

Live Queries (subscriptions) seemed great, turn any query into a subscription
with hardly any changes, but it wasn't quite what we wanted. Our queries return
long lists of items, and if a single item changes we don't want to get every
other item again.
What we want is just the delta, just the info about what was changed so we can
update it in the store.

We ended up creating an audit log table which is automatically populated using
triggers.  Any changes to the database, either made through Hasura, Rails or
any ad-hoc queries are recorded in this table. Our trigger is based on this
[`"audit-trigger"`](https://github.com/hasura/audit-trigger) scripts, provided
by Hasura.

We then set up a live query on top of this audit log, so that as data is
changed, each client gets an update about what changed. We configure this
subscription to only include actions made on the same account but by other
users.

Debugging live query performance has been a pain point, Hasura doesn't provide
any tools to inspect what SQL query is generated for live queries, which batch
multiple similar live queries into a single SQL query.


Using Hasura in Production
--------------------------

We have been very satisified with Hasura and are glad we made the switch. 

Hasura can transform each of our GraphQL queries into a single efficient SQL
query. We are no longer concerned about request loading times when using the
GraphQL API. Our app continues to make the same GraphQL requests, but the
request completes at a much faster time, especially for our largest customers.

We no longer need to build and maintain a server for resolving GraphQL queries
and mutations. We are usin Hasura's built-in mutations to insert, update and
delete values.  For more complicated mutations, we are making good use of
Hasura Actions to call back to our Ruby on Rails API. 

We are planning to migrate to a Node.js server and Hasura should help make this
easier by allowing us to move each migration individually without having to
update the client app.

Hasuras roles and permissions model is flexible enough that we can implement
the Runn permissions model, allowing us to configure which table columns a
particular user is allowed to read/write. For example, some Runn users do not
have permission to access financial data on the account and we can use Hasura
roles to enforce that permission.

Hasura Live Queries are being used to implement real-time updates for users on
the same account using WebSockets.

**Impact on the team**

There was a learning curve getting the team onboarded with Hasura and
reconfiguring our deployment process, but we adapted quickly and Hasura is
generally a joy to use.

- Super easy to add a new table, just need to create a DB migration and Hasura
  will automatically detect it. Then we just configure the permissions in
  Hasura to make sure that the authenticated user can only access the rows that
  they own.
- The Hasura Console is very useful for debugging queries, showing which SQL
  query is generated along with an analysis of the SQL execution plan
