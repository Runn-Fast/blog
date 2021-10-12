# Hasura

**What problem are we solving?**

- Performance issues with serving "large" amounts of data from Ruby on Rails
    graphql API, hitting network timeouts on hasura (30s).
- Relying on hackier workarounds to improve performance they get in the way of
    building our app

Why we chose Hasura?

- Compared to alternatives?
   - postgraphile
   - ruby on rails

- How we migrated from one GraphQL API to another
- lessons we learned
- issues we faced
- performance benefits

....

- PERFORMANCE has been a key factor.
- we load a lot of data upfront
- being able to do a single efficient SQL query for each GraphQL request is key
- Able to extend hasura with HTTP actions, these allow mutations/queries to
    call out to a custom server endpoint

CONVENIENCE
Don't have to maintain our own graphql api server code

COMPUTED FIELDS
sql functions
to transform data // sits in between database and client
doesn't support returning a single row (unless it's a scalar), only an array
runn returns the "current contract" -- needs to return either an empty array or
an array of one item

AUTHENTICATION
with jwt tokens
managed by ruby on rails

ROLES
-----

to restrict data access based on user
prevent users from accessing data that is not in their account
need to make sure to setup permissions on each table so that no data can be
leaked

HOSTING
on heroku is hard
writing our own github actions to provision heroku servers
changing the way we deploy to heroku to make it easier to work with docker
containers

SUBSCRIPTIONS
easy to setup, hard to debug
live queries aren't weren't what we wanted
had to create an audit log table to sync data update between clients

RELAY
-----

bastardised relay setup
slight performance cost with relay endpoint
aren't using the relay endpoint, instead we use the graphql endpoint and force
it to work
aren't using pagination

Relay: Views are not exposed #5044 
https://github.com/hasura/graphql-engine/issues/5044
Still not fixed, means we can't use relay mode


...

Started this journey back in October 2020

> The two platforms we are looking at are:
> - Hasura (https://hasura.io/)
> - PostGraphile (https://www.graphile.org/postgraphile/) (edited) 
> - 
> Using a service like one of these means we don't need to create/maintain our
> own GraphQL server -- it's done automatically based on our database layout

From day 1 it was clear that Hasura was the fastest option:

Rowan:
I did a test with three engines, on an account that has 4000 project, 1000
people, and 57,098 assignments (if my math is right)
- Ruby: 59s
- PostGraphile Relay: 4.95s
- Hasura Relay: 3.15s
- Hasura Apollo: 1.78s
- So I think from the serve side of things, we can probably easily support
- Euronext by changing to a new GraphQL Engine. Although, obviously moving to a
- new graphQL engine has a bunch of complications behind it.

...

REMOTE SCHEMAS
We first tried to have Hasura proxy our Ruby API
But it didn't allow us to mix queries between servers, i.e. a single query
couldn't resolve data from both the database and the Ruby API.

HASHIDS
Our Ruby API uses hashids
We decided to switch to database ids
Still need to use relay global ids → using a SQL function to generate these
manually for each table

we take our tables `id` field and we rename it to `db_id` in hasura
+ we add the computed field `global_id`
+ in our relay graphql query, we use `global_id` for relay internal caching 
    and we use `db_id` for app logic

BULK UPDATE
Using Insert + Update on Conflict

VIEWER
Creating a SQL function to return the current user 

users → all users on the account
users_viewer →  currently authenticated user

--- 

MIGRATION

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


---

HASURA CLOUD

has utils for debugging performance, but we have noticed performance issues
running on the cloud (we assume it's because it's not co-located with our
postgresql database)

---

SUPPORT

reasonably good experience
would like to learn haskell so we can contribute to the code base

---

CONCLUSION

Quite happy with hasura

1. Runn, what it does, and your engineering team.

- Why you chose Hasura to replace your then existing Ruby on Rails backend
- What problems were you trying to solve & how Hasura helped overcome them
========================================================================

Problems we were facing
-----------------------

- Hitting performance limits of Ruby on Rails.
- Our web app is designed to fetch all the data it needs on page load, worked
  fine on small accounts, but on larger accounts with hundreds of people and
  projects, it would take tens of seconds for the server to respond.
- We host on Heroku and were already using the fastest tier of server dyno
  availably, but still request would take longer than 30 seconds and get timed out by
  the Heroku Router.

We knew there was plenty of room for performance improvements, fetching the
data we need directly from the database was practically instantaneous in
comparison to requesting it through Rails.

No one in the team had strong expertise in Ruby on Rails, or else it probably
would be possible to tune the server. Our CTO had already eeked out as much
performance as he could from the server and was confident that any more
improvements would require radical changes, so sticking with Rails wasn't going
to be any easier than switching to something else.

We were looking for a performant GraphQL server.

We considered rewriting the GraphQL Server in Node.js with Apollo Server, but
we weren't sure that would be good enough. We would need to make sure our SQL
queries were as efficient as possible to minimise overhead when resolving large
queries.

We liked Hasura because it would convert each GraphQL query into a single SQL
query, which is incredible for performance.

We also liked not having to maintain our our GraphQL resolver code, including
auth and subscriptions. Hasura handles all of this for us automatically.

We also looked at Postgraphile as an alternative, but were swayed by Hasura
because of superior performance and support for custom actions. Postgraphile
also requires using SQL triggers which were wary of using.

Insights about the migration process & experience
=================================================

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

Insights from using specific Hasura features that helped you get successful
===========================================================================
