import * as migration_20260629_111224_fresh_schema from './20260629_111224_fresh_schema';
import * as migration_20260712_181257_item_content_model from './20260712_181257_item_content_model';
import * as migration_20260715_051848_multi_tenant from './20260715_051848_multi_tenant';
import * as migration_20260715_155701_settings_entitlement from './20260715_155701_settings_entitlement';
import * as migration_20260715_180048_remove_article_legacy_fields from './20260715_180048_remove_article_legacy_fields';

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
  {
    up: migration_20260715_155701_settings_entitlement.up,
    down: migration_20260715_155701_settings_entitlement.down,
    name: '20260715_155701_settings_entitlement',
  },
  {
    up: migration_20260715_180048_remove_article_legacy_fields.up,
    down: migration_20260715_180048_remove_article_legacy_fields.down,
    name: '20260715_180048_remove_article_legacy_fields'
  },
];
