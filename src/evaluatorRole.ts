import { Role } from "@prisma/client";

const acronyms = new Set(['VFX', 'UI']);

export const roleArray = Object.keys(Role);
export const roleEnglishArray = roleArray.map(
	(role, _index) =>
		role
			.replace('_', ' ')
			.toLowerCase()
			.split(' ') // Isolate words
			.map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize first letter
			.map(word =>
				acronyms.has(word.toUpperCase()) ? word.toUpperCase() : word,
			)
			.join(' '), // Combine
);