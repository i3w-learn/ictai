import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { SettingsService } from './settings.service.js';

export function settingsRoutes(app: FastifyInstance, deps: { settings: SettingsService }) {
  const { settings } = deps;
  route(app, 'GET /api/v1/settings', () => settings.school());
  route(app, 'PUT /api/v1/settings', ({ body, principal }) => settings.save(asStaff(principal), body));
  route(app, 'GET /api/v1/me/prefs', ({ principal }) => settings.prefs(asStudent(principal)));
  route(app, 'PUT /api/v1/me/prefs', ({ body, principal }) => settings.setPrefs(asStudent(principal), body));
}
