import Koa from 'koa';
import Router from '@koa/router';

// Create Koa application
const app = new Koa();
const router = new Router();

// Add some middleware
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  ctx.set('X-Response-Time', `${ms}ms`);
});

// Define routes
router.get('/', async (ctx) => {
  ctx.body = { message: 'Hello from Koa on Cloud Functions!' };
});

// Use router middleware
app.use(router.routes());
app.use(router.allowedMethods());

// Export handler
export default app;
