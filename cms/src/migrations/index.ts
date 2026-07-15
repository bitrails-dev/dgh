import * as migration_20260629_111224_fresh_schema from './20260629_111224_fresh_schema';
import * as migration_20260712_181257_item_content_model from './20260712_181257_item_content_model';
import * as migration_20260715_051848_multi_tenant from './20260715_051848_multi_tenant';

export const migrations = [
  {
    up: migration_20260629_111224_fresh_schema.up,
    down: migration_20260629_111224_fresh_schema.down,
    name: '20260629_111224_fresh_schema',
  },
  {
    up: migration_20260712_181257_item_content_model.up,
    down: migration_20260712_181257_item_content_model.down,
    name: '20260712_181257_item_content_model',
  },
  {
    up: migration_20260715_051848_multi_tenant.up,
    down: migration_20260715_051848_multi_tenant.down,
    name: '20260715_051848_multi_tenant',
  },
];
