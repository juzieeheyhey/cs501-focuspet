/**
 * POST a session object to the backend.
 * @param {Object} sessionData - The session payload matching the backend CreateSessionDto.
 *   Example: { userId, startTime, endTime, durationSession, activity, focusScore }
 * @returns {Promise<Object>} - The created session returned by the server.
 * @throws {Error} on network or server error.
 */
export async function postSession(sessionData) {
	const BASE = window.BACKEND_BASE || 'http://localhost:5185';
	const url = `${BASE.replace(/\/$/, '')}/api/session`;

	const token = localStorage.getItem('authToken');

	const headers = {
		'Content-Type': 'application/json',
	};
	if (token) headers['Authorization'] = `Bearer ${token}`;

	const resp = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify(sessionData),
	});

	if (!resp.ok) {
		const txt = await resp.text().catch(() => resp.statusText || 'Server error');
		throw new Error(`Failed to post session: ${resp.status} ${txt}`);
	}

	// return parsed JSON (created session)
	return await resp.json();
}

/**
 * GET a single session by ID.
 * @param {string} sessionId - The ID of the session to retrieve.
 * @returns {Promise<Object>} - The session object from the backend.
 * @throws {Error} - If the request fails.
 */
export async function getSession(sessionId) {
	if (!sessionId) throw new Error('sessionId is required');

	const BASE = window.BACKEND_BASE || 'http://localhost:5185';
	const url = `${BASE.replace(/\/$/, '')}/api/session/${sessionId}`;

	const token = localStorage.getItem('authToken');
	const headers = { 'Content-Type': 'application/json' };
	if (token) headers['Authorization'] = `Bearer ${token}`;

	const resp = await fetch(url, { headers });

	if (!resp.ok) {
		const txt = await resp.text().catch(() => resp.statusText || 'Server error');
		throw new Error(`Failed to get session ${sessionId}: ${resp.status} ${txt}`);
	}

	return await resp.json();
}

/** 
 * GET a list of sessions by UserId
 * @route GET /api/session/user/{userId}
 * @param {string} userId - The ID of the user whose sessions are being retrieved.
 * @returns {Promise<Array<Object>>} A list of session documents associated with the user.
 */
export async function getSessionByUser(userId) {
	if (!userId) throw new Error('userId is required')

	const BASE = window.BACKEND_BASE || 'http://localhost:5185';
	const url = `${BASE.replace(/\/$/, '')}/api/session/user/${userId}`;
	const token = localStorage.getItem('authToken');
	const headers = { 'Content-Type': 'application/json' };
	if (token) headers['Authorization'] = `Bearer ${token}`;

	const resp = await fetch(url, { headers });
	if (!resp.ok) {
		const msg = await resp.text().catch(() => resp.statusText);
		throw new Error(`Failed to get sessions: ${resp.status} ${msg}`);
	}

	return resp.json();

}

export default { postSession, getSession, getSessionByUser };
