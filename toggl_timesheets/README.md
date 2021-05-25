Using the Runn API to sync Toggl Timesheets 
===========================================

Note: That this article only covers how to do "one-way" sync, we are taking the
total time worked for each person on each project from Toggl and sending that
to Runn. If you change the value in Runn it will not be updated in Toggl.

The API gives you a flexible way of importing data.

- Using External IDs in Runn to link people & projects with external services.

1. Edit Person Details
2. Expand the "External IDs" section
3. Select "Custom1" and paste

### Simple Syncing Script

I'm going to use Javascript with Node.js to build a simple syncing tool, but
you can use any programming language or framework you want.

### API Keys

Before we start you'll need to get your API key for Runn and Toggl.

In Runn you'll find this in the Settings page. Runn has a neat feature called
the "Test Account", it gives you a way to experiment with Runn and try making
changing without affecting data in your "Live Account". I would recommend
switching to your "Test Account" and using the API key for that first. 

You can tell it's your test account API Key because it will start with "TEST_".

You can switch to your production account later.

[screenshot of settings page]

In Toggl this is under your account detials page.

[screenshot of toggl]

### Dependencies

To make using these HTTP API's easy, I will be using the `got` library. 

```shell
npm install got
```

Now we can create a `sync_toggl_with_runn.js` script. Let's start by importing `got` and
defining our API keys.

```javascript
const got = require('got')

const TOGGL_API_KEY = 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
const RUNN_API_KEY = 'TEST_XXXXXXXXXXXXXXXXXXXX'
```

### API Wrappers

The `got` library has a neat feature where we can easily customize it to make
it work with a particular API. 

Instead of having to supply the same config repeatedly for each request, we can
use `got.extend` to just define this once.

For example, each API request to Runn will always start with
`https://app.runn.io/api/' -- so we can use the `prefixUrl` option.

Each request to Runn requires the `Authorization` header to be set
to your API key.

The Runn API also responds with data in the JSON format, so we can tell `got`
to parse the JSON for us.

```javascript
const runn = got.extend({
  prefixUrl: 'https://app.runn.io/api/',
  headers: {
    Authorization: `Bearer ${RUNN_API_KEY}`
  },
  responseType: 'json',
})
```

We can do the same thing for the Toggl API.

Toggl authenticates with the username & password option.

```javascript
const toggl = got.extend({
  prefixUrl: 'https://api.track.toggl.com/',
  username: TOGGL_API_KEY,
  password: 'api_token',
  responseType: 'json',
})
```

### Getting a list of projects from Runn

```javascript
const getProjectsFromRunn = async () => {
  const response = await runn.get('v0/projects')
  return response.body
}
```

The response body will look like:

```json
[{
  "references": {
    "Custom1": {
      "external_id": "8348292"
    }
  }
}, ...]
```

### Getting a list of people from Runn

```javascript
const getPeopleFromRunn = async () => {
  const response = await runn.get('v0/people')
  return response.body
}
```

The response body will look like:

```json
[{
  "references": {
    "Custom1": {
      "external_id": "8348292"
    }
  }
}, ...]
```

### Looking up a person or project by their external ID

Let's create a helper function to easily retrieve a person/project by it's
external ID.

In Runn, external IDs are always kept as strings. In Toggl, IDs can also be
numbers so we will convert the provided ID to a string (if it's not already).

We an then use the `.find` method to loop through each item of the list and
return the first one that has a matching ID.

Note that we define a new constant, `RUNN_EXTERNAL_ID_KEY` -- this refers to
the key we used when assigning external IDs back in part 1 of this post.

```javascript
const RUNN_EXTERNAL_ID_KEY = 'Custom1'

const findItemByExternalId = (list, externalId) => {
  const referenceString = String(externalID)
  return list.find((item) => {
    if (item.references.hasOwnProperty(RUNN_EXTERNAL_ID_KEY)) {
      return item.references[RUNN_EXTERNAL_ID_KEY].external_id === referenceString
    }
    return false
  })
}
```

We can use this function like this:

```javascript
const people = await getPeopleFromRunn()
const person = findItemByExternalId(people, externalId)
```

### Getting a report of the projects worked on today in Toggl

The Toggl API has an endpoint for getting a weekly summary of all the projects
that have been worked on and by whom.

This endpoint can return data for a range of days, but this example we are just
going to look at the data for the current date.

This function expects the date to be in the form "YYYY-MM-DD".

```javascript
const getWeeklyReportFromToggl = async (date) => {
  const response = await toggl.get('reports/api/v2/weekly', {
    searchParams: {
      user_agent: 'sync_with_runn',
      workspace_id: TOGGL_WORKSPACE_ID,
      since: date,
      until: date,
    }
  })
  return response.body
}
```

The response body from Toggl will look like:

```json
{
  "data": {
  }
}, ...}
```

### Writing data to Runn

The last API call we need is to update the "Actuals" data in Runn.

In Runn, each person can have time scheduled for them to work on a particular
project -- but the data 

```javascript
const postActualTimeToRunn = async (options) => {
  const response = await runn.post('v0/actuals', {
    json: {
      date: options.date
      project_id: options.projectId,
      person_id: options.personId,
      role_id: options.roleId,
      billable_minutes: options.billableMinutes,
    },
  })
  return response.body
}
```

### Putting it all together

We need to get the current date in YYYY-MM-DD format, there are some JS
libraries (such as `luxon`), but we can just use the builtin Date class for
now.

Toggl tracks time in milliseconds, while Runn uses minutes, so we will need to
convert between them. Note that the Runn API only allows `billable_minutes` to
be an integer, so we need to round to the nearest minute.

```javascript
const main = async () => {
  // get the current date in the form YYYY-MM-DD
  const today = new Date().toISOString().split('T')[0]

  const projects = await getProjectsFromRunn()
  const people = await getPeopleFromRunn()
  const report = await getWeeklyReportFromToggl(today)

  for (const item of report.data) {
    for (const person of item.details) {
      const runnPerson = findItemByReference(people, person.uid)
      if (runnPerson == null) {
        console.log(`There are no people in Runn that have the reference: "${RUNN_EXTERNAL_ID_KEY}=${person.uid}"`)
        continue
      }

      const runnProject = findItemByReference(projects, item.pid)
      if (runnProject == null) {
        console.log(`There are no projects in Runn that have the reference: "${RUNN_EXTERNAL_ID_KEY}=${item.pid}"`)
        continue
      }

      // convert from total time from milliseconds to minutes (must be a whole number)
      const billableMinutes = Math.round(person.totals[7] / 1000 / 60)

      await postActualTimeToRunn({
        date: today,
        projectId: runnProject.id,
        personId: runnPerson.id,
        roleId: runnPerson.role_id,
        billableMinutes,
      })

      console.log(`${runnProject.name}: ${runnPerson.name} (${runnPerson.role.name}) @ ${billableMinutes} minutes`)
    }
  }
}

main()
```

### Running the syncing script

```shell
$ node sync_toggl_with_runn.js
```

### Next steps

You could improve this script to:

- scheduling this script to run multiple times a day
- handle request failures
- sync data for multiple days, not just today
