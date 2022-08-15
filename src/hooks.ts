import cookie from 'cookie';
import type { GetSession, Handle } from '@sveltejs/kit';
import { PUBLIC_DISCORD_URL as DISCORD_API_URL, PUBLIC_HOST_URL as HOST, } from '$env/static/public';
import { GetUserByDiscordID, UpdateDiscordUser } from '$db/database';

export const handle: Handle = async ({ event, resolve }) => {
	const browserCookies = cookie.parse(event.request.headers.get("cookie") || "");

	event.locals.discord_access_token = browserCookies.discord_access_token;
	event.locals.discord_refresh_token = browserCookies.discord_refresh_token;

	const { session, cookies } = await getUser(event.locals);
	const { discordUser, user } = session;

	event.locals.discordUser = discordUser;
	event.locals.user = user;

	const response = await resolve(event);

	if (cookies) {
		for (const cookie of cookies) {
			response.headers.append("Set-Cookie", cookie);
		}
	}

	return response;
}

export const getSession: GetSession = async ({ locals }) => {

	if (locals.discordUser) {
		return {
			discordUser: locals.discordUser,
			user: locals.user ?? false,
		}
	}

	const { session, } = await getUser(locals);

	return session;
}

async function getUser(locals: App.Locals): Promise<{ session: App.Session, cookies?: string[] }> {

	if (!locals.discord_access_token && !locals.discord_refresh_token) {
		return { session: { discordUser: false, user: false }};
	}

	if (!locals.discord_access_token && locals.discord_refresh_token) {
		return refreshUser(locals.discord_refresh_token);
	}

	if (locals.discord_access_token) {
		return fetchUser(locals.discord_access_token);
	}

	// not authenticated, return empty user object
	return {
		session: {
			discordUser: false,
			user: false
		}
	}
}

async function fetchUser(token: string): Promise<{ session: App.Session, cookies?: string[] }> {

	const request = await fetch(`${DISCORD_API_URL}/users/@me`, {
		headers: { 'Authorization': `Bearer ${token}`}
	});

	// returns a discord user if JWT was valid
	const response = await request.json();
	const discordUser = { ...response };

	const user = (await GetUserByDiscordID(response.id)) ?? false;

	if (user && user.id) {
		UpdateDiscordUser(user.id, discordUser);
	}

	if (response.id) { 
		return { session: { discordUser: discordUser, user: user }};
	} else {
		return { session: { discordUser: false, user: false }};
	}

}

async function refreshUser(token: string): Promise<{ session: App.Session, cookies?: string[] }> {
	const failure: { session: App.Session } = { session: { discordUser: false, user: false } };
	const discord_request = await fetch(`${HOST}/api/refresh?code=${token}`);

	if (discord_request.status !== 200) return failure;
	
	try {
		const discord_response = await discord_request.json();

		if (!discord_response.discord_access_token) return failure;

		const request = await fetch(`${DISCORD_API_URL}/users/@me`, {
			headers: { 'Authorization': `Bearer ${discord_response.discord_access_token}` }
		});

		const response = await request.json();
		const discordUser = { ...response };

		const user = (await GetUserByDiscordID(discordUser.id)) ?? false;

		if (user && user.id) {
			UpdateDiscordUser(user.id, discordUser);
		}

		if (response.id) {
			return { 
				session: { discordUser: discordUser, user: user },
				cookies: discord_response.cookies
			}
		};
	} catch (error) {
		return failure;
	}

	return failure;
}