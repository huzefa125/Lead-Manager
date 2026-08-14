import { Router } from 'express';
import { authRouter } from '../auth/auth.routes';
import { leadRouter, leadSourceRouter, leadStageRouter } from '../leads';
import { organizationRouter } from '../organizations';
import { permissionRouter, roleRouter, userRouter } from '../rbac';
import { sendSuccess } from '../utils/api-response';

export const apiRouter = Router();

/**
 * Feature routers mount here. A new business module (employees, departments)
 * adds its router alongside these and gates each route with
 * `authorize('<resource>.<operation>')` — no change to the RBAC internals.
 */
apiRouter.use('/auth', authRouter);
apiRouter.use('/organizations', organizationRouter);
apiRouter.use('/roles', roleRouter);
apiRouter.use('/permissions', permissionRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/leads', leadRouter);
apiRouter.use('/lead-sources', leadSourceRouter);
apiRouter.use('/lead-stages', leadStageRouter);

apiRouter.get('/', (_req, res) => {
  sendSuccess(res, {
    name: 'lead-manager-api',
    version: '3.0.0',
    docs: { ui: 'GET /api/docs', spec: 'GET /api/docs.json' },
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        refresh: 'POST /api/auth/refresh',
        logout: 'POST /api/auth/logout',
        logoutAll: 'POST /api/auth/logout-all',
        me: 'GET /api/auth/me',
      },
      organizations: {
        current: 'GET /api/organizations/current',
        list: 'GET /api/organizations',
        create: 'POST /api/organizations',
        get: 'GET /api/organizations/:id',
        update: 'PATCH /api/organizations/:id',
        remove: 'DELETE /api/organizations/:id',
      },
      roles: {
        list: 'GET /api/roles',
        create: 'POST /api/roles',
        get: 'GET /api/roles/:id',
        update: 'PATCH /api/roles/:id',
        remove: 'DELETE /api/roles/:id',
        setPermissions: 'PUT /api/roles/:id/permissions',
        addPermissions: 'POST /api/roles/:id/permissions',
        removePermissions: 'DELETE /api/roles/:id/permissions',
      },
      permissions: {
        list: 'GET /api/permissions',
        create: 'POST /api/permissions',
        get: 'GET /api/permissions/:id',
        update: 'PATCH /api/permissions/:id',
        remove: 'DELETE /api/permissions/:id',
      },
      users: {
        list: 'GET /api/users',
        get: 'GET /api/users/:id',
        setRoles: 'PUT /api/users/:id/roles',
        addRoles: 'POST /api/users/:id/roles',
        removeRoles: 'DELETE /api/users/:id/roles',
      },
      leads: {
        list: 'GET /api/leads',
        create: 'POST /api/leads',
        capture: 'POST /api/leads/capture',
        funnel: 'GET /api/leads/funnel',
        get: 'GET /api/leads/:id',
        update: 'PATCH /api/leads/:id',
        remove: 'DELETE /api/leads/:id',
        assign: 'PUT /api/leads/:id/assignment',
        changeStage: 'PUT /api/leads/:id/stage',
        timeline: 'GET /api/leads/:id/timeline',
        logActivity: 'POST /api/leads/:id/activities',
      },
      leadSources: {
        list: 'GET /api/lead-sources',
        create: 'POST /api/lead-sources',
        get: 'GET /api/lead-sources/:id',
        update: 'PATCH /api/lead-sources/:id',
        remove: 'DELETE /api/lead-sources/:id',
      },
      leadStages: {
        list: 'GET /api/lead-stages',
        create: 'POST /api/lead-stages',
        get: 'GET /api/lead-stages/:id',
        update: 'PATCH /api/lead-stages/:id',
        remove: 'DELETE /api/lead-stages/:id',
      },
    },
  });
});
