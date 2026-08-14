import { Router } from 'express';
import { authRouter } from '../auth/auth.routes';
import { permissionRouter, roleRouter, userRouter } from '../rbac';
import { sendSuccess } from '../utils/api-response';

export const apiRouter = Router();

/**
 * Feature routers mount here. A new business module (employees, departments)
 * adds its router alongside these and gates each route with
 * `authorize('<resource>.<operation>')` — no change to the RBAC internals.
 */
apiRouter.use('/auth', authRouter);
apiRouter.use('/roles', roleRouter);
apiRouter.use('/permissions', permissionRouter);
apiRouter.use('/users', userRouter);

apiRouter.get('/', (_req, res) => {
  sendSuccess(res, {
    name: 'auth-service',
    version: '2.0.0',
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
    },
  });
});
