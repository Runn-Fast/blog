import got from 'got';

/**
	API config.
	Update these variables with your own email and API keys.
*/

const YOUR_EMAIL_ADDRESS = 'your.email@example.com';

const TOGGL_API_KEY = '201383f81b3109c26bf9186f611adb8f';
const TOGGL_WORKSPACE_ID = '5411215';

const RUNN_API_KEY = 'TEST_BcgrVHeHzsb5hsu29zTM';
const RUNN_EXTERNAL_ID_KEY = 'Custom1';

/**
	API helper functions.
*/

const runnAPI = got.extend({
	prefixUrl: 'https://app.runn.io/api/',
	headers: {
		Authorization: `Bearer ${RUNN_API_KEY}`,
	},
	responseType: 'json',
});

const togglAPI = got.extend({
	prefixUrl: 'https://api.track.toggl.com/',
	username: TOGGL_API_KEY,
	password: 'api_token',
	responseType: 'json',
});

const getWeeklyReportFromToggl = async isoDateString => {
	const response = await togglAPI.get('reports/api/v2/weekly', {
		searchParams: {
			user_agent: YOUR_EMAIL_ADDRESS,
			workspace_id: TOGGL_WORKSPACE_ID,
			since: isoDateString,
			until: isoDateString,
		},
	});

	return response.body;
};

const getProjectsFromRunn = async () => {
	const response = await runnAPI.get('v0/projects');
	return response.body;
};

const getPeopleFromRunn = async () => {
	const response = await runnAPI.get('v0/people');
	return response.body;
};

const postActualTimeToRunn = async body => {
	const response = await runnAPI.post('v0/actuals', {
		json: body,
	});
	return response.body;
};

/* Helper functions */

const findItemByReference = (list, reference) => {
	const referenceString = String(reference);
	return list.find(item => {
		if (item.references[RUNN_EXTERNAL_ID_KEY]) {
			return item.references[RUNN_EXTERNAL_ID_KEY].external_id === referenceString;
		}

		return false;
	});
};

/* Sync function */

const main = async () => {
	// Get the current date in the form YYYY-MM-DD
	const isoDateString = new Date().toISOString().split('T')[0];

	const report = await getWeeklyReportFromToggl(isoDateString);

	const projects = await getProjectsFromRunn();
	const people = await getPeopleFromRunn();

	const promises = report.data.flatMap(item => item.details.map(person => {
		const runnPerson = findItemByReference(people, person.uid);
		if (!runnPerson) {
			console.log(`Could not find person "${person.title.user}" in Runn, looking for reference: "${RUNN_EXTERNAL_ID_KEY}=${person.uid}"`);
			return undefined;
		}

		const runnProject = findItemByReference(projects, item.pid);
		if (!runnProject) {
			console.log(`Could not find project "${item.title.project}" in Runn, looking for reference: "${RUNN_EXTERNAL_ID_KEY}=${item.pid}"`);
			return undefined;
		}

		// Convert from total time from milliseconds to minutes (must be a whole number)
		const billableMinutes = Math.round(person.totals[7] / 1000 / 60);

		console.log(`${runnProject.name}: ${runnPerson.name} (${runnPerson.role.name}) @ ${billableMinutes} minutes`);

		return postActualTimeToRunn({
			date: isoDateString,
			project_id: runnProject.id,
			person_id: runnPerson.id,
			role_id: runnPerson.role_id,
			billable_minutes: billableMinutes,
		});
	}));

	await Promise.all(promises);
};

main().catch(error => {
	console.error(error);
	if (error?.response?.body) {
		console.error(error.response.body);
	}
});
