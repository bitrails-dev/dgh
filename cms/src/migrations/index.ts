import * as migration_20260629_111224_fresh_schema from './20260629_111224_fresh_schema';
import * as migration_20260712_181257_item_content_model from './20260712_181257_item_content_model';
import * as migration_20260715_051848_multi_tenant from './20260715_051848_multi_tenant';
import * as migration_20260715_155701_settings_entitlement from './20260715_155701_settings_entitlement';
import * as migration_20260715_180048_remove_article_legacy_fields from './20260715_180048_remove_article_legacy_fields';
import * as migration_20260715_190731_tenant_types from './20260715_190731_tenant_types';
import * as migration_20260715_200619_social_publishing from './20260715_200619_social_publishing';
import * as migration_20260715_231356_social_publishing_collections from './20260715_231356_social_publishing_collections';
import * as migration_20260715_233507_article_auto_publish from './20260715_233507_article_auto_publish';
import * as migration_20260716_122728_social_publishing_jobs from './20260716_122728_social_publishing_jobs';
import * as migration_20260716_124059_social_selection_sessions from './20260716_124059_social_selection_sessions';
import * as migration_20260716_135203_social_oauth_pkce from './20260716_135203_social_oauth_pkce';
import * as migration_20260717_100000_commerce_inventory from './20260717_100000_commerce_inventory';
import * as migration_20260717_100100_commerce_settings_events from './20260717_100100_commerce_settings_events';
import * as migration_20260717_100200_commerce_orders from './20260717_100200_commerce_orders';
import * as migration_20260717_100300_commerce_products from './20260717_100300_commerce_products';
import * as migration_20260717_100400_commerce_carts_customers from './20260717_100400_commerce_carts_customers';
import * as migration_20260717_100500_commerce_products_media_variants from './20260717_100500_commerce_products_media_variants';

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
    name: '20260715_180048_remove_article_legacy_fields',
  },
  {
    up: migration_20260715_190731_tenant_types.up,
    down: migration_20260715_190731_tenant_types.down,
    name: '20260715_190731_tenant_types',
  },
  {
    up: migration_20260715_200619_social_publishing.up,
    down: migration_20260715_200619_social_publishing.down,
    name: '20260715_200619_social_publishing',
  },
  {
    up: migration_20260715_231356_social_publishing_collections.up,
    down: migration_20260715_231356_social_publishing_collections.down,
    name: '20260715_231356_social_publishing_collections',
  },
  {
    up: migration_20260715_233507_article_auto_publish.up,
    down: migration_20260715_233507_article_auto_publish.down,
    name: '20260715_233507_article_auto_publish',
  },
  {
    up: migration_20260716_122728_social_publishing_jobs.up,
    down: migration_20260716_122728_social_publishing_jobs.down,
    name: '20260716_122728_social_publishing_jobs',
  },
  {
    up: migration_20260716_124059_social_selection_sessions.up,
    down: migration_20260716_124059_social_selection_sessions.down,
    name: '20260716_124059_social_selection_sessions',
  },
  {
    up: migration_20260716_135203_social_oauth_pkce.up,
    down: migration_20260716_135203_social_oauth_pkce.down,
    name: '20260716_135203_social_oauth_pkce'
  },
  {
    up: migration_20260717_100000_commerce_inventory.up,
    down: migration_20260717_100000_commerce_inventory.down,
    name: '20260717_100000_commerce_inventory',
  },
  {
    up: migration_20260717_100100_commerce_settings_events.up,
    down: migration_20260717_100100_commerce_settings_events.down,
    name: '20260717_100100_commerce_settings_events',
  },
  {
    up: migration_20260717_100200_commerce_orders.up,
    down: migration_20260717_100200_commerce_orders.down,
    name: '20260717_100200_commerce_orders',
  },
  {
    up: migration_20260717_100300_commerce_products.up,
    down: migration_20260717_100300_commerce_products.down,
    name: '20260717_100300_commerce_products',
  },
  {
    up: migration_20260717_100400_commerce_carts_customers.up,
    down: migration_20260717_100400_commerce_carts_customers.down,
    name: '20260717_100400_commerce_carts_customers',
  },
  {
    up: migration_20260717_100500_commerce_products_media_variants.up,
    down: migration_20260717_100500_commerce_products_media_variants.down,
    name: '20260717_100500_commerce_products_media_variants',
  },
];
