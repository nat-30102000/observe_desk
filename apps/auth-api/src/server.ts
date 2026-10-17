import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { createVerifier, entraKeys } from './verify.js';

const config = loadConfig();
const store = new Store(config.dataFile);
for (const t of config.seedTenants) if (!store.orgByTenant(t.tenantId)) store.createOrg(t.tenantId, t.name);

const app = createApp({ config, store, verify: createVerifier({ audiences: config.audiences, getKey: entraKeys() }) });
app.listen(config.port, () => console.log(`auth-api on :${config.port} (${config.mode} mode, ${store.listOrgs().length} organizations)`));
