Migrating Runn to the Hasura GraphQL Engine
===========================================

{{{

- voice: team of developers at Runn (not George, no I)
- audience: people with interest in the back-end, not necessarily a deep
    technical background

}}}

Index
-----

1. The Problem
2. The Proposed Solution
3. The Migration
4. The Actual Result
5. The Future

1. The Problem
--------------

When Runn first launched, it was designed for small and medium sized companies
to help plan their projects. We strived to make Runn as fast as possible while
also providing plenty of useful features.

But it didn't take long for large companies to become interested in Runn,
bringing along hundreds of people and projects to manage. We noticed
performance issues with load times and making changes was no longer instant.

Improving performance of a web app is never as easy as fixing one simple thing,
it typically involves tuning each part of the system. We did our best to
optimize performance of the database, server and front-end client, but we knew
that major changes needed to be achieve the performance for accounts with
hundreds of people.

The slowest part of the system was our GraphQL API, it was just really slow to respond to large queries. Our server is powered by Ruby on Rails using the `graphql` gem.

> **todo (easy):**
> - large@example.com:
>   - 200 people
>   - 232 projects
>   - 17,891 assignments
>   - 22,785 actuals
> - how much data we load on the planner right now?
>   - large@example.com: 3200kb (253kb compressed)
> - how much data does the project overview report use
>   - large@example.com: 6700kb (475kb compressed)

> **todo (hard):**
> - go back to `85ee353` 
> - get stats on response size/duration for a large account (600 people)
> - also find out how many database requests we were making.
> - craft a SQL query that gets the same data from the database
> - compare to making the same request with Hasura 

The server be able to send XXXkb of data pretty quickly. From our
investigation, the trouble lies in assembling the data to send. We have XX
tables in our PostgreSQL database

This isn't really that much data, but it is from all over the database. The
way our Rails GraphQL server resolved queries meant it would make many requests to the database gather the data it needed, some in parallel, other requests in series. 

The server then needed to reshape this data into the proper structure needed by
the client. Each request is very quick, but with so a

Our servers run on Heroku, which has a hard limit of 30 seconds to respond to a
request. If the server takes longer than that, the connection is cut and the request fails. Usually, requests should be completed within a second, but on large accounts we started hitting that timeout limit. This would cause the app to fail to load.

We found that if we loaded the data directly from the database, bypassing
Rails, the data could be fetched in a few milliseconds. This told us that there
was plenty of room for performance improvements and that Rails was the
bottleneck.

We had already optimized Rails as much as we could, any further improvements
would require radical changes, but we didn't have any developers with the deep
knowledge of Ruby on Rails. These performance optimizations often came at the
cost of making the code base more complex and harder to maintain.

2. Our Proposed Solution
------------------------

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

3. The Migration
----------------

> Moving our production web app from Rails to Hasura

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

### Computed Fields

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

4. The Actual Result
--------------------

Feb 2021: upgrade production deploy scripts to get Hasura v1.3 configured
Mar 2021: initial release on production app start querying Hasura
MarOur initial released to production in March 2021 with Hasura v1.3
May 2021 we had all the pages migrated
June 2021: Migrate Planner to Hasura API
July 2021: Upgrade to Hasura v2
In July 2021 we completely removed the original Rails Relay store 

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


### Impact on the team

There was a learning curve getting the team onboarded with Hasura and
reconfiguring our deploy process, but we adapted quickly and Hasura is
generally a joy to use.

- Super easy to add a new table, just need to create a DB migration and Hasura
  will automatically detect it. Then we just configure the permissions in
  Hasura to make sure that the authenticated user can only access the rows that
  they own.
- The Hasura Console is very useful for debugging queries, showing which SQL
  query is generated along with an analysis of the SQL execution plan

### Our Favourite Features of Hasura

#### Automatic GraphQL API generation

Don't have to maintain our own graphql api server code

#### JWT Authentication

with jwt tokens
managed by ruby on rails

#### Computed Fields

sql functions
to transform data // sits in between database and client
doesn't support returning a single row (unless it's a scalar), only an array
runn returns the "current contract" -- needs to return either an empty array or
an array of one item

#### Permissions

to restrict data access based on user
prevent users from accessing data that is not in their account
need to make sure to setup permissions on each table so that no data can be
leaked

#### HOSTING

on heroku is hard
writing our own github actions to provision heroku servers
changing the way we deploy to heroku to make it easier to work with docker
containers

#### Live Queries

easy to setup, hard to debug
live queries aren't weren't what we wanted
had to create an audit log table to sync data update between clients

#### RELAY

bastardised relay setup
slight performance cost with relay endpoint
aren't using the relay endpoint, instead we use the graphql endpoint and force
it to work
aren't using pagination

Relay: Views are not exposed #5044 
https://github.com/hasura/graphql-engine/issues/5044
Still not fixed, means we can't use relay mode

5. The Future
-------------

> Where we plan to go from here

- start using Node.js to handle Action's, shouldn't require any changes to the
    front-end
- would like to learn haskell so we can contribute to the code base
- compute more values on the server side, either using SQL functions or Actions
- fetch only the data we need when the app loads, and pull data as the user
    navigates around the app

















---

Out Of Scope
============

> Stuff left over that I am not covering now

### Data-loading Decisions

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
 
### HASHIDS

Our Ruby API uses hashids
We decided to switch to database ids
Still need to use relay global ids → using a SQL function to generate these
manually for each table

we take our tables `id` field and we rename it to `db_id` in hasura
+ we add the computed field `global_id`
+ in our relay graphql query, we use `global_id` for relay internal caching 
    and we use `db_id` for app logic

### REMOTE SCHEMAS

We first tried to have Hasura proxy our Ruby API
But it didn't allow us to mix queries between servers, i.e. a single query
couldn't resolve data from both the database and the Ruby API.

### BULK UPDATE

Using Insert + Update on Conflict

### Hasura Cloud

- has utils for debugging performance, but we have noticed performance issues
  running on the cloud (we assume it's because it's not co-located with our
  postgresql database)

### SUPPORT

- reasonably good experience
