import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Preserve legacy categories whenever the relationship backfill has not run yet.
  await db.run(sql`UPDATE \`articles\`
    SET \`category_rel_id\` = (
      SELECT \`categories\`.\`id\`
      FROM \`categories\`
      WHERE \`categories\`.\`slug\` = \`articles\`.\`category\`
    )
    WHERE \`category_rel_id\` IS NULL
      AND \`category\` IS NOT NULL;`)

  // Abort instead of silently discarding a category whose relationship could not be resolved.
  await db.run(sql`CREATE TEMP TABLE \`_article_category_cleanup_guard\` (
    \`unresolved\` integer NOT NULL CHECK (\`unresolved\` = 0)
  );`)
  await db.run(sql`INSERT INTO \`_article_category_cleanup_guard\` (\`unresolved\`)
    SELECT count(*)
    FROM \`articles\`
    WHERE \`category_rel_id\` IS NULL
      AND trim(coalesce(\`category\`, '')) <> '';`)
  await db.run(sql`DROP TABLE \`_article_category_cleanup_guard\`;`)

  // Convert a body-only article into a localized Rich Text block before dropping the old column.
  // Articles that already have blocks deliberately ignore `body`, so no duplicate block is added.
  await db.run(sql`INSERT INTO \`articles_blocks_rich_text\`
    (\`_order\`, \`_parent_id\`, \`_path\`, \`id\`)
    SELECT 1, a.\`id\`, 'content', 'legacy-body-' || a.\`id\`
    FROM \`articles\` AS a
    WHERE trim(coalesce(a.\`body\`, '')) <> ''
      AND NOT EXISTS (SELECT 1 FROM \`articles_blocks_rich_text\` AS b WHERE b.\`_parent_id\` = a.\`id\`)
      AND NOT EXISTS (SELECT 1 FROM \`articles_blocks_heading\` AS b WHERE b.\`_parent_id\` = a.\`id\`)
      AND NOT EXISTS (SELECT 1 FROM \`articles_blocks_image\` AS b WHERE b.\`_parent_id\` = a.\`id\`)
      AND NOT EXISTS (SELECT 1 FROM \`articles_blocks_youtube\` AS b WHERE b.\`_parent_id\` = a.\`id\`)
      AND NOT EXISTS (SELECT 1 FROM \`articles_blocks_testimonial\` AS b WHERE b.\`_parent_id\` = a.\`id\`);`)

  await db.run(sql`INSERT INTO \`articles_blocks_rich_text_locales\`
    (\`rich_text\`, \`_locale\`, \`_parent_id\`)
    SELECT json_object(
      'root', json_object(
        'children', json_array(json_object(
          'children', json_array(json_object(
            'detail', 0,
            'format', 0,
            'mode', 'normal',
            'style', '',
            'text', a.\`body\`,
            'type', 'text',
            'version', 1
          )),
          'direction', NULL,
          'format', '',
          'indent', 0,
          'type', 'paragraph',
          'version', 1,
          'textFormat', 0,
          'textStyle', ''
        )),
        'direction', NULL,
        'format', '',
        'indent', 0,
        'type', 'root',
        'version', 1
      )
    ), locale.\`code\`, b.\`id\`
    FROM \`articles_blocks_rich_text\` AS b
    JOIN \`articles\` AS a ON a.\`id\` = b.\`_parent_id\`
    CROSS JOIN (SELECT 'ar' AS \`code\` UNION ALL SELECT 'en') AS locale
    WHERE b.\`id\` = 'legacy-body-' || a.\`id\`;`)

  await db.run(sql`ALTER TABLE \`articles\` DROP COLUMN \`category\`;`)
  await db.run(sql`ALTER TABLE \`articles\` DROP COLUMN \`body\`;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`articles\` ADD \`category\` text;`)
  await db.run(sql`ALTER TABLE \`articles\` ADD \`body\` text;`)
  await db.run(sql`UPDATE \`articles\`
    SET \`category\` = (
      SELECT \`categories\`.\`slug\`
      FROM \`categories\`
      WHERE \`categories\`.\`id\` = \`articles\`.\`category_rel_id\`
    );`)
  await db.run(sql`UPDATE \`articles\`
    SET \`body\` = (
      SELECT json_extract(l.\`rich_text\`, '$.root.children[0].children[0].text')
      FROM \`articles_blocks_rich_text\` AS b
      JOIN \`articles_blocks_rich_text_locales\` AS l ON l.\`_parent_id\` = b.\`id\`
      WHERE b.\`_parent_id\` = \`articles\`.\`id\`
        AND b.\`id\` = 'legacy-body-' || \`articles\`.\`id\`
        AND l.\`_locale\` = 'en'
    )
    WHERE EXISTS (
      SELECT 1
      FROM \`articles_blocks_rich_text\` AS b
      WHERE b.\`_parent_id\` = \`articles\`.\`id\`
        AND b.\`id\` = 'legacy-body-' || \`articles\`.\`id\`
    );`)
  await db.run(sql`DELETE FROM \`articles_blocks_rich_text_locales\`
    WHERE \`_parent_id\` IN (
      SELECT \`id\`
      FROM \`articles_blocks_rich_text\`
      WHERE \`id\` = 'legacy-body-' || \`_parent_id\`
    );`)
  await db.run(sql`DELETE FROM \`articles_blocks_rich_text\`
    WHERE \`id\` = 'legacy-body-' || \`_parent_id\`;`)
}
