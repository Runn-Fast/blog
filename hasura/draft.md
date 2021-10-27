Migrating Runn to the Hasura GraphQL Engine
===========================================

In the beginning, Runn was designed for small and medium sized companies to
help plan their projects. As part of the developer team, we strived to make
Runn as fast as possible and with plenty of useful features.

But it didn't take long for large companies to become interested in Runn, bringing along hundreds of projects and people to manage. We started to notice performance issues with load times and the app started to feel sluggish.

Our development team did their best to get the app running performantly, but it
started taking longer to add new features. Ultimately, we knew that major
changes needed to be achieve the performance with these larger customers.

The Problem
-----------

Improving performance of a web app is never as easy as fixing one simple thing,
it typically involves tuning each part of the system.

We did our best to optimize performance of the database, server and front-end
client, but there was a bottleneck.

Our GraphQL API was quite slow to respond to large queries.

The front-end client of the Runn app is written in React with the Relay GraphQL
client. Because it was designed with small/medium sized accounts, we made the
decision to fetch all the data we needed when the app is opened. 

**Pros:**

- Once data is loaded, navigation and searching of data is instant
- Budgets and forecasts can be recalculated as assignments are moved/resized
- Don't need to handle async loading of data (easier to maintain)

**Cons:**

- The downside is that the more projects and people an account has, the longer
  it takes for the app to load.

### Technical Details

Querying the GraphQL server on a medium sized account.

_todo: go back to Oct 2020 and get stats on response size/duration_

This isn't really that much data, but it is from all over the database. The
way out Rails GraphQL server resolved queries meant it would make multiple (sometimes hundreds) of SQL queries to gather the data it needed. The server then needed to reshape this data into the proper structure needed by the client. All of this extra work quickly added up.

Our servers run on Heroku, which has a hard limit of 30 seconds to respond to a
request. If the server takes longer than that, the connection is cut and the request fails. Usually, requests should be completed within a second, but on large accounts we started hitting that timeout limit. This would cause the app to fail to load.

We found that if we loaded the data directly from the database, by passing
Rails, the data could be fetched in a few milliseconds. This told us that there
was plenty of room for performance improvements and that Rails was the
bottleneck.

We had already optimized Rails as much as we could, any further improvements
would require radical changes, but we didn't have any developers with the deep
knowledge of Ruby on Rails. These performance optimizations often came at the
cost of making the code base more complex and harder to maintain.

We started looking at alternative solutions, specifically looking for fast and
efficient GraphQL servers. 

We found Hasura and Postgraphile, which are both quite similar.

Simply, they read the schema of your database and expose a GraphQL API ready to
use. They also use very advanced techniques of transforming each GraphQL query
into a single SQL query to maximize performance. 

Why we chose Hasura
-------------------

It was October 2020 and we were looking for a performant GraphQL server.

We considered rewriting the GraphQL Server in Node.js with Apollo Server, but
we knew that this would be a lot of work. We would need to make sure our SQL
queries were as efficient as possible to minimise overhead when resolving large
queries, as well as handling exceptions and making sure the whole thing was
secure.

Hasura, an open source GraphQL engine.

From our initial testing it was clear that Hasura was the fastest option.
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

Obviously these benchmarks weren't the most accurate, but it gave us hope that
switching to a new GraphQL engine would give us the performance improvements we
were looking for.


The idea of not having to write our GraphQL server also appealed to us. Hasura
provides query resolves for each table along with mutations to insert, update
and delete rows.

Results of using Hasura in Production
-------------------------------------

Quite happy with hasura after the migration.

Hasura can transform each of our GraphQL queries into a single efficient SQL
query. We are no longer concerned about request loading times when using the
GraphQL API.

Our app continues to fetch all the data on page load, but the request completes
at a much faster time, even for our largest customers.

We no longer need to maintain our own GraphQL resolvers and mutations.

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

Hasura Live Queries are being used to implement realtime updates for users on
the same account with websockets.

We have looked into Hasura Cloud but are opting to host it ourselves at the
moment.

---

- PERFORMANCE has been a key factor.
- we load a lot of data upfront
- being able to do a single efficient SQL query for each GraphQL request is key
- Able to extend hasura with HTTP actions, these allow mutations/queries to
    call out to a custom server endpoint

### CONVENIENCE

Don't have to maintain our own graphql api server code

### COMPUTED FIELDS

sql functions
to transform data // sits in between database and client
doesn't support returning a single row (unless it's a scalar), only an array
runn returns the "current contract" -- needs to return either an empty array or
an array of one item

### AUTHENTICATION

with jwt tokens
managed by ruby on rails

### HASURA CLOUD

- has utils for debugging performance, but we have noticed performance issues
  running on the cloud (we assume it's because it's not co-located with our
  postgresql database)

### SUPPORT

- reasonably good experience
- would like to learn haskell so we can contribute to the code base

The Migration Process
---------------------

### REMOTE SCHEMAS

We first tried to have Hasura proxy our Ruby API
But it didn't allow us to mix queries between servers, i.e. a single query
couldn't resolve data from both the database and the Ruby API.

### HASHIDS

Our Ruby API uses hashids
We decided to switch to database ids
Still need to use relay global ids → using a SQL function to generate these
manually for each table

we take our tables `id` field and we rename it to `db_id` in hasura
+ we add the computed field `global_id`
+ in our relay graphql query, we use `global_id` for relay internal caching 
    and we use `db_id` for app logic

### BULK UPDATE

Using Insert + Update on Conflict

### VIEWER

Creating a SQL function to return the current user 

users → all users on the account
users_viewer →  currently authenticated user

Not a standard migration.

Our front-end web app uses the Relay GraphQL Client, but we haven't fully
embraced the Relay way of doing things.

Looked at using the Hasura Relay API (still in beta) but decided not to.
- Slower performance
- Certain features were not supported in the Hasura Relay API (such as querying views)

So we decided to use the Hasura GraphQL API.
We needed to configure our project to use two different configs for the Relay
Compiler. Each GraphQL query in the project gets validated against a schema and
typescript types are generated. For this to work, the compiler needs to know which schema to use.
We found that the relay compiler could be configured to include/exclude certain folders based on a pattern.
We used that to migrate the app one page at a time to Hasura.

During the migration, We effectively had two Relay stores, each with their own
cache running in parallel.
Sometimes we would need to mutate data that is in both stores and that required
manually updating the cache.

Live Queries (subscriptions) seemed great, turn any query into a subscription
with hardly any changes, but it wasn't quite what we wanted. Our queries return
long lists of items, and if a single item changes we don't want to get every
other item again.
What we want is just the delta, just the info about what was changed so we can
update it in the store.

We ended up creating an audit log table which is automatically populated using triggers.
Any changes to the database, either made through Hasura, Rails or any ad-hoc
queries are recorded in this table. Our trigger script is based on
[`audit-trigger`](https://github.com/hasura/audit-trigger) which is provided by
Hasura.

We then set up a live query on top of this audit log, so that as data is
changed, each client gets an update about what changed. We configure this
subscription to only include actions made on the same account but by other
users.

Debugging live query performance has been a pain point, Hasura doesn't provide
any tools to inspect what SQL query is generated for live queries, which batch
multiple similar live queries into a single SQL query.

### MIGRATION

a bit complicated with relay

- creating two relay "environments"
   * one environment for ruby api
   * another environment for hasura api
- relay compiler can be configured to include/exclude certain directories
   * we added the suffix `_hasura` to all directories that we had migrated to
       hasura 
   * any graphql queries in those directories would be compiled with the hasura
       schema
   * any graphql queries outside of those directories would use the ruby schema
- allowed us to release hasura in chunks without having to migrate every page
    over at the same time.

Impact on the developer & feature velocity for your team
========================================================

There was a learning curve getting the team onboarded with Hasura and
reconfiguring our deploy process, but we adapted quickly and Hasura is
generally a joy to use.

- Super easy to add a new table, just need to create a DB migration and Hasura
  will automatically detect it. Then we just configure the permissions in
  Hasura to make sure that the authenticated user can only access the rows that
  they own.
- The Hasura Console is very useful for debugging queries, showing which SQL
  query is generated along with an analysis of the SQL execution plan

Our Favourite Features of Hasura
--------------------------------

### ROLES

to restrict data access based on user
prevent users from accessing data that is not in their account
need to make sure to setup permissions on each table so that no data can be
leaked

### HOSTING

on heroku is hard
writing our own github actions to provision heroku servers
changing the way we deploy to heroku to make it easier to work with docker
containers

### SUBSCRIPTIONS

easy to setup, hard to debug
live queries aren't weren't what we wanted
had to create an audit log table to sync data update between clients

### RELAY

bastardised relay setup
slight performance cost with relay endpoint
aren't using the relay endpoint, instead we use the graphql endpoint and force
it to work
aren't using pagination

Relay: Views are not exposed #5044 
https://github.com/hasura/graphql-engine/issues/5044
Still not fixed, means we can't use relay mode
