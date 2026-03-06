/**
 * User profile loader.
 * Fetches and formats user data from the API response.
 */

export interface UserPreferences {
	theme: string;
	notifications: boolean;
	language: string;
}

export interface UserProfile {
	id: number;
	name: string;
	email: string;
	role: string;
	preferences: UserPreferences;
}

export interface ApiResponse {
	data: unknown;
	status: number;
	requestId: string;
}

/**
 * Parse an API response into a typed UserProfile.
 *
 * BUG: `as UserProfile` silences the type checker but does not validate
 * the actual shape. The API response may omit the `preferences` field
 * (e.g., for users created before preferences were added), causing
 * downstream code to crash with TypeError on preferences.theme.
 */
function parseUserResponse(response: ApiResponse): UserProfile {
	if (response.status !== 200) {
		throw new Error(`API error: status ${response.status}`);
	}
	// BUG: blindly asserting the shape without checking if preferences exists
	return response.data as UserProfile;
}

/**
 * Get the active UI theme for a user.
 */
export function getUserTheme(response: ApiResponse): string {
	const user = parseUserResponse(response);
	// Throws: "Cannot read properties of undefined (reading 'theme')"
	// when preferences is missing from the API response
	return user.preferences.theme;
}

/**
 * Format a one-line summary of a user's account settings.
 */
export function formatUserSummary(response: ApiResponse): string {
	const user = parseUserResponse(response);
	const theme = user.preferences?.theme ?? "default";
	const notifs = user.preferences?.notifications ?? false;
	const lang = user.preferences?.language ?? "en";
	return `${user.name} (${user.email}) — theme: ${theme}, notifications: ${notifs ? "on" : "off"}, language: ${lang}`;
}

/**
 * Get user display name with role badge.
 */
export function getUserDisplayName(response: ApiResponse): string {
	const user = parseUserResponse(response);
	return `${user.name} [${user.role}]`;
}
