# node-red-contrib-influxdb-backup
A Node-RED node for performing influx database backup using `influxd backup`.

It creates a backup of the specified database in the configured folder, using `portable` mode.

## Prerequisites

See the [Influxdb docs for influxd backup](https://docs.influxdata.com/influxdb/v1.8/administration/backup_and_restore/) in order to understand exactly how influx backup/restore works.  In particular note the section about configuring `bind-address` in `influxdb.conf`.  The node has been tested using influxdb 1.8.0, at the time of writing it is unclear whether the backup command has changed for Influxdb 2.0.

If the Influx database is on a remote server then influx must also be installed on the machine running node-red, so that the `influxd` command is available.

## Install

Use the Node-RED `Manage Palette` menu option or run the following in your Node-RED user directory (typically `~/.node-red`):

    npm install node-red-contrib-influxdb-backup

## Configuration and Inputs

### Folder
The destination folder for the backup files, may be configured as a string or as a message attribute. If the folder does not exist then it will be created.

### Database
The database to be backed up, may be configured as a string or as a message attribute.  If this is missing or an empty string then all databases are backed up.

### Host
The hostname or IP address of the machine running influxdb. Defaults to `locahost`. May be configured as a string or as a message attribute.

### Port
The port to use to connect to influxdb. Defaults to `8088`. May be configured as a string or as a message attribute.

### Clear folder
If this is `true` then any previous backup files are deleted before the backup is run.  May be configured as a boolean or provided as a message attribute (which must be boolean `true` or string "true", anything else is interpreted as false).

### Unzip and rename files
If this is `true` then the backup files (which are `.tar.gz` files) are unzipped after the backup is performed, then they are all renamed from the standard format `YYYYMMDDTHHMMSSZ.*.tar.gz` to `<prefix>.*.tar`.  In addition the manifest file contents are adjusted for the modified filenames.  This is useful when using a regular backup strategy that uses incremental backups or some form of deduplication such as Borg or Back In Time.  Most of the files in the influx backup do not change at each backup, so the backup strategy does not need to make new copies of them (the timestamps will be different but the contents the same).  It is necessary to unzip the files as the original gz files do differ each time, I imagine the gz file includes the timestamps of the embedded files, which will be different.  May be configured as a boolean or provided as a message attribute (which must be boolean `true` or string "true", anything else is interpreted as false).  
If it is required to restore the backup it is just necessary to zip them up again, on linux `gzip *.tar` will suffice, then run the restore command as documented in the influx link earlier.

### Prefix
When Unzip and rename is requested then this sets the filename to use. May be configured as a string or as a message attribute.

### Start time
The start of the time range to backup may be provided by passing a string in `msg.start`.  The string must be formatted exactly as defined in the Influxdb link above.  For example `"2020-06-01T12:00:00Z"`.
If `msg.start` is not provided then the backup will be from the earliest data in the database.

### End time
The end of the time range to backup may be provided by passing a string in `msg.end`.  The string must be formatted exactly as defined in the Influxdb link above.  For example `"2020-07-01T12:00:00Z"`.
If `msg.end` is not provided then the backup will be up to the latest data in the database.

## Outputs
### 1. Standard Output 
The standard output of the backup command.  Multiple progress messages will be sent as the backup proceeds.  This ouput is provided in case of problems, or to allow confirmation that the expected backup has been performed.

### 2. Standard Error
The standard error output from the backup command, and error messages from other actions.  There may be multiple error messages.

### 3. Return Code
The payload is an object containing the attribute `code` containing the return code. Zero implies success.  This message will be sent when the operation is complete.

### Catch
A linked Catch node will send a message containing details of any error.  There will be at most one Catch message.  There will not be both Catch and Complete messages.

### Complete
A linked Complete node will send a message on successful completion.  No message will be sent if there is an error.


