# node-red-contrib-influxdb-backup
A Node-RED node for performing influx database backup using `influxd backup`.

It creates a backup of the specified database in the configured folder, using `portable` mode.

See the [Influxdb docs for influxd backup](https://docs.influxdata.com/influxdb/v1.8/administration/backup_and_restore/) in order to understand exactly how influx backup/restore works.  In particular note the section about configuring `bin-address` in `influxdb.conf`.

## Install

Use the Node-RED `Manage Palette` command or run the following in your Node-RED user directory (typically `~/.node-red`):

    npm install node-red-contrib-influxdb-backup

## Configuration

### Folder
The destination folder, may be configured as a string or as a message attribute.

### Database
The database to be backed up, may be configured as a string or as a message attribute.

### Host
The hostname or IP address of the machine running influxdb. Defaults to `locahost`. May be configured as a string or as a message attribute.

### Port
The port to use to connect to influxdb. Defaults to `8088`. May be configured as a string or as a message attribute.

### Clear destination folder
If this is `true` then any previous backup files are deleted before the backup is run.  May be configured as a boolean or provided as a message attribute (which must be boolean `true` or string "true", anything else is interpreted as false)

### Unzip files
If this is `true` then the backup files (which are `.tar.gz` files) are unzipped after the backup is performed.  This is useful if the files are to be backed up using a de-duplicating backup application such as `borg`.  After unzipping all files containing data from before the previous backup will have the same content as in the last backup so even though the filenames have changed the contents are not and the de-duplication algorithm will mean they take up a very small additional space in the archive.


## Node status
The state of the gate is indicated by a status object: text.

