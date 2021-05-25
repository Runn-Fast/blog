const got = require('got')

const TOGGL_API_KEY = '201383f81b3109c26bf9186f611adb8f'
const TOGGL_WORKSPACE_ID = '5411215'

const RUNN_API_KEY = 'TEST_BcgrVHeHzsb5hsu29zTM'
const RUNN_EXTERNAL_ID_KEY = 'Custom1'

/* api wrappers */

const runn = got.extend({
  prefixUrl: 'https://app.runn.io/api/',
  headers: {
    Authorization: `Bearer ${RUNN_API_KEY}`
  },
  responseType: 'json',
})

const toggl = got.extend({
  prefixUrl: 'https://api.track.toggl.com/',
  username: TOGGL_API_KEY,
  password: 'api_token',
  responseType: 'json',
})

const getWeeklyReportFromToggl = async (isoDateString) => {
  const response = await toggl.get('reports/api/v2/weekly', {
    searchParams: {
      user_agent: 'george@runn.io',
      workspace_id: TOGGL_WORKSPACE_ID,
      since: isoDateString,
      until: isoDateString,
    }
  })

  return response.body
}

const getProjectsFromRunn = async () => {
  const response = await runn.get('v0/projects')
  return response.body
}

const getPeopleFromRunn = async () => {
  const response = await runn.get('v0/people')
  return response.body
}

const postActualTimeToRunn = async (body) => {
  const response = await runn.post('v0/actuals', {
    json: body,
  })
  return response.body
}

/* helper functions */

const findItemByReference = (list, reference) => {
  const referenceString = String(reference)
  return list.find((item) => {
    if (item.references.hasOwnProperty(RUNN_EXTERNAL_ID_KEY)) {
      return item.references[RUNN_EXTERNAL_ID_KEY].external_id === referenceString
    }
    return false
  })
}

/* sync function */

const main = async () => {
  // get the current date in the form YYYY-MM-DD
  const isoDateString = new Date().toISOString().split('T')[0]

  const projects = await getProjectsFromRunn()
  const people = await getPeopleFromRunn()

  console.log(JSON.stringify(projects, null, 2))
  console.log(JSON.stringify(people, null, 2))

  const report = await getWeeklyReportFromToggl(isoDateString)

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
        date: isoDateString,
        project_id: runnProject.id,
        person_id: runnPerson.id,
        role_id: runnPerson.role_id,
        billable_minutes: billableMinutes,
      })

      console.log(`${runnProject.name}: ${runnPerson.name} (${runnPerson.role.name}) @ ${billableMinutes} minutes`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  if (error.response != null) {
    console.error(error.response.body)
  }
})
