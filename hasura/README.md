Migrating Runn to the Hasura GraphQL Engine
===========================================

The Problem
-----------

When Runn first launched, it was designed for small and medium-sized companies
to help plan their projects. We strived to make Runn as fast as possible while
also providing plenty of useful features.

But it didn't take long for large companies to become interested in Runn,
bringing along hundreds of people and projects to manage. We noticed
performance issues with load times and making changes was no longer instant.

Improving the performance of a web app is never as easy as fixing one simple
thing, it typically involves optimizing each part of the system. We did our
best to increase the performance of the database, server and front-end client, but we knew that major changes were needed to achieve the performance for accounts with hundreds of people.

The slowest part of the system was our GraphQL API, it was just really slow to
respond to large queries. Our server is powered by Ruby on Rails using the
`graphql` gem.

> **todo (easy):**
> - large@example.com:
>   - 200 people
>   - 232 projects
>   - 17,891 assignments
>   - 22,785 actuals
> - how much data do we load on the planner right now?
>   - large@example.com: 3200kb (253kb compressed)
> - how much data does the project overview report use
>   - large@example.com: 6700kb (475kb compressed)

> **todo (hard):**
> - go back to `85ee353` 
> - get stats on response size/duration for a large account (600 people)
> - also, find out how many database requests we were making.
> - craft a SQL query that gets the same data from the database
> - compare to making the same request with Hasura 

The server  can send XXXkb of data pretty quickly. From our
investigation, the trouble lies in assembling the data to send. We have XX
tables in our PostgreSQL database

This isn't that much data, but it is from all over the database. The way our
Rails GraphQL server resolved queries meant it would make many requests to the
database to gather the data it needed, some in parallel, other requests in
series. It then needs to parse and format this data into the structure
requested by the client.

Our servers run on Heroku, which has a hard limit of 30 seconds to respond to a
request. If the server takes longer than that, the connection is cut and the
request fails. Usually, requests should be completed within a second, but on
large accounts, we started hitting that timeout limit. This would cause the app
to fail to load.

We found that if we loaded the data directly from the database, bypassing
Rails, the data could be fetched in a few milliseconds. This told us that there
was plenty of room for performance improvements and that Rails was the
bottleneck.

We had already optimized Rails as much as we could, any further improvements
would require radical changes, but we didn't have any developers with the deep
knowledge of Ruby on Rails. These performance optimizations often came at the
cost of making the code base more complex and harder to maintain.

Our Proposed Solution
---------------------

> Why we chose Hasura and how we planned to use it

It was October 2020 and we were looking for a performant GraphQL server.

We started looking at alternative solutions, specifically looking for fast and
efficient GraphQL servers. 

We found Hasura and Postgraphile, which are both quite similar.

Simply, they read the schema of your database and expose a GraphQL API ready to
use. They also use very advanced techniques of transforming each GraphQL query
into a single SQL query to maximize performance. 


We considered rewriting the GraphQL Server in Node.js with Apollo Server, but
we knew that this would be a lot of work. We would need to make sure our SQL
queries were as efficient as possible to minimise overhead when resolving large
queries, as well as handling exceptions and making sure the whole thing was
secure.

Hasura, an open-source GraphQL engine.

From our initial testing, it was clear that Hasura was the fastest option.
Behind the scenes, it would convert each GraphQL request into just a single SQL
query, which is incredible for performance.

It does require that your database schema is aligned with your API, fortunately
for us, our database already was.

We did some benchmarking on an extremely large account, with 4000 projects,
1000 people and nearly 60,000 assignments.

- Ruby: 59s
- PostGraphile Relay: 4.95s
- Hasura Relay: 3.15s
- Hasura Apollo: 1.78s

We had a look at Postgraphile as another option. Hasura had a larger community,
more features and allowed
Postgraphile also seemed to require using SQL triggers which were wary of using.
One serious benefit of using Postgraphile was that it was written in JavaScript
(Hasura is written in Haskell) and would be a lot easier for us to contribute
to.

_todo: downsides of using postgraphile_

These benchmarks weren't the most accurate, but they gave us hope that
switching to a new GraphQL engine would give us the performance improvements we
were looking for.


The idea of not having to write our GraphQL server also appealed to us. Hasura
provides query resolves for each table along with mutations to insert, update
and delete rows.

So we decided to use the Hasura GraphQL API.




The Migration
-------------

How we made the switch to Hasura.

We didn't want to migrate all of Run to Hasura in just a single step. We
knew the migration would involve making _many, many_ changes, taking months of
work. All these changes would likely conflict with other features being developed in parallel, which would slow us down further. It also increased the risk of bugs as the entire app would need to be thoroughly tested.

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

We are using Relay in the front end app. Like most GraphQL clients, it assumes
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

We are using Relay on the front end. Hasura provides a special endpoint,
specifically for Relay, but it doesn't currently support Actions, so we are
using the standard GraphQL endpoint instead.

Making good use of Computed Fields.

- get the current user
- get the Relay global ID for an item

users → all users on the account
users_viewer →  currently authenticated user

### 4. Creating the Actions we need

Our Rails GraphQL API has several mutations that don't easily map to the
built-in Hasura mutations.

For example, we have a mutation to bulk update a list of assignments. It
handles merging assignments, deleting assignments, creating new
assignments.

It would be possible to update our front end to call multiple GraphQL
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






The Actual Result
-----------------

Feb 2021: upgrade production deploy scripts to get Hasura v1.3 configured
Mar 2021: initial release on production app start querying Hasura
MarOur initial released to production in March 2021 with Hasura v1.3
May 2021 we had all the pages migrated
June 2021: Migrate Planner to Hasura API
July 2021: Upgrade to Hasura v2
In July 2021 we completely removed the original Rails Relay store 

Quite happy with Hasura after the migration.

Hasura can transform each of our GraphQL queries into a single efficient SQL
query. We are no longer concerned about request loading times when using the
GraphQL API.

Our app continues to fetch all the data on page load, but the request completes
at a much faster time, even for our largest customers.

We no longer need to build and maintain a server for resolving GraphQL queries
and mutations.

We are making use of Hasura's mutations when possible, to insert, update and
delete rows.

Hasuras roles and permissions model is flexible enough for the Runn permissions
model, allowing us to configure which table columns a particular user is
allowed to read/write. For example, some Runn users do not have permission to
access financial data on the account and we can use Hasura roles to enforce
that permission.

For more complicated mutations, we are making good use of Hasura Actions to
call back to our Ruby on Rails API. We are planning to migrate to a Node.js
server and Hasura should help make this easier by allowing us to move each
migration individually without having to update the client app.

Hasura Live Queries are being used to implement real-time updates for users on
the same account using WebSockets.

- PERFORMANCE has been a key factor.
- we load a lot of data upfront
- being able to do a single efficient SQL query for each GraphQL request is key
- Able to extend Hasura with HTTP actions, these allow mutations/queries to
    call out to a custom server endpoint

### Impact on the team

There was a learning curve getting the team onboarded with Hasura and
reconfiguring our deployment process, but we adapted quickly and Hasura is
generally a joy to use.

- Super easy to add a new table, just need to create a DB migration and Hasura
  will automatically detect it. Then we just configure the permissions in
  Hasura to make sure that the authenticated user can only access the rows that
  they own.
- The Hasura Console is very useful for debugging queries, showing which SQL
  query is generated along with an analysis of the SQL execution plan


The Future
----------

> Where we plan to go from here

- start using Node.js to handle Action's, shouldn't require any changes to the
    front end
- would like to learn Haskell so we can contribute to the code base
- compute more values on the server-side, either using SQL functions or Actions
- fetch only the data we need when the app loads, and pull data as the user
    navigates around the app


- We have looked into Hasura Cloud but are opting to host it ourselves at the
moment.
