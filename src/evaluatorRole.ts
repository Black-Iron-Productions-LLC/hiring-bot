import {DeveloperRole, ManagerRole} from '@prisma/client';

const acronyms = new Set(['VFX', 'UI']);

export const roleArray = Object.keys(DeveloperRole);
export const roleEnglishArray = roleArray.map(
	(role, _index) =>
		roleToEnglish(role),
);

const abbreviationReplacements = [
	{from: 'EXEC_', to: 'EXECUTIVE_'},
	{from: 'HIRMGR_', to: 'HIRING_MANAGER_'},
	{from: 'APPMGR_', to: 'APPLICATION_MANAGER_'},
	{from: 'REF_', to: 'REFFERAL_'},
];

export const managerRoleArray = Object.keys(ManagerRole);
export const managerRoleEnglishArray = Object.keys(ManagerRole).map(
	(role, _index) => roleToEnglish(role),
);

export function roleToEnglish(value: string) {
	return value
		.replaceAll('_', ' ')
		.toLowerCase()
		.split(' ') // Isolate words
		.map(word => word.charAt(0).toUpperCase() + word.slice(1)) // Capitalize first letter
		.map(word =>
			acronyms.has(word.toUpperCase()) ? word.toUpperCase() : word,
		)
		.join(' '); // Combine
}

export function roleEnglishReverse(value: string) {
	value = value.toUpperCase().replaceAll(' ', '_');

	for (const replacement of abbreviationReplacements) {
		value.replaceAll(replacement.to, replacement.from);
	}

	if (!managerRoleArray.includes(value) && !roleArray.includes(value)) {
		return null;
	}

	return value;
}
