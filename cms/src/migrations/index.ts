import * as migration_20260629_100000_media_and_uploads from './20260629_100000_media_and_uploads';

export const migrations = [
  {
    up: migration_20260629_100000_media_and_uploads.up,
    down: migration_20260629_100000_media_and_uploads.down,
    name: '20260629_100000_media_and_uploads'
  },
];
