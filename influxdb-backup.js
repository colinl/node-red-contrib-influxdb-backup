/**
 * Copyright 2020 Colin Law
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
module.exports = function(RED) {
   
    function InfluxBackupNode(config) {
        RED.nodes.createNode(this,config);
        let PromisifyChildProcess = require('promisify-child-process');
        let fs = require('fs');
        let util = require('util')
        let pako = require('pako');
        const { exec, spawn/*, fork, execFile*/ } = PromisifyChildProcess;
        const execOpt = {encoding: 'binary', maxBuffer: 10000000, shell: '/bin/bash'}
        const {promisify} = util;
        const readdirP = promisify(fs.readdir)
        const unlinkP = promisify(fs.unlink)
        const readFileP = promisify(fs.readFile)
        const writeFileP = promisify(fs.writeFile)
        const renameP = promisify(fs.rename)

        const waitingStatus = {text:''};
        const clearingStatus = {fill:'green',shape:'dot',text:'Clearing'};
        const runningStatus = {fill:'green',shape:'dot',text:'Running Backup'};
        const unzippingStatus = {fill:'green',shape:'dot',text:'Unzipping'};
        const errorStatus = {fill:'red',shape:'dot',text:'Error'};

        // Copy configuration items
        this.folderConfig = config.folder || "";
        this.folderType = config.folderType || "str"
        this.databaseConfig = config.database;
        this.databaseType = config.databaseType || "str"
        this.hostConfig = config.host;
        this.hostType = config.hostType || "str"
        this.portConfig = config.port;
        this.portType = config.portType || "str"
        this.clearfolderConfig = config.clearfolder;
        this.clearfolderType = config.clearfolderType || "bool";
        this.unzipConfig = config.unzip;
        this.unzipType = config.unzipType || "bool";
        this.prefixConfig = config.prefix;
        this.prefixType = config.prefixType || "str";
        
        // Save "this" object
        let node = this;

        let currentProcess = null;
        let watchdogTimer = null;

        let msgQueue = [];

        node.on('input', function(msg, send, done) {
          // push this one onto the queue
          msgQueue.push( {thisMsg: msg, thisSend: send, thisDone: done} )
          // if there is now only one in the queue then nothing going on so handle it immediately
          // otherwise already dealing with one so nothing more to do
          if (msgQueue.length == 1) {
            node.log("handling immediate")
            handleMessage(msgQueue[0].thisMsg, msgQueue[0].thisSend, msgQueue[0].thisDone)
            // leave it in the queue, it will be shifted out when done
          } else {
            node.log("Queued " + msgQueue.length)
          }
        });

        node.on('close', function() {
          node.log("Closing")
          //node.log("Closing " + msgQueue.length)
          // kill the current process if any
          if (currentProcess) {
              node.log("killing")
              currentProcess.kill()
              currentProcess = null
          }
          // stop the timer if active
          node.log("stopping watchdog")
          stopWatchdog()
          node.log("stopped")
          // empty the queue
          msgQueue.length = 0    // yes, this is valid javascript
          node.log("Length now " + msgQueue.length)
          node.log("returning now")
        });

        function handleMessage(msg, send, done) {
          // If this is pre-1.0, 'send' will be undefined, so fallback to node.send
          send = send || function() { node.send.apply(node,arguments) }          

          currentProcess = null;
          watchdogTimer = null;
          let returnCode = 0;
          let errorDetails = null;

          let folder = RED.util.evaluateNodeProperty(node.folderConfig, node.folderType, node, msg)
          let database = RED.util.evaluateNodeProperty(node.databaseConfig, node.databaseType, node, msg)
          let host = RED.util.evaluateNodeProperty(node.hostConfig, node.hostType, node, msg)
          let port = RED.util.evaluateNodeProperty(node.portConfig, node.portType, node, msg)
          let clearfolder = RED.util.evaluateNodeProperty(node.clearfolderConfig, node.clearfolderType, node, msg)
          // only allow boolean true or string "true" to be true
          clearfolder = (clearfolder === true || clearfolder === "true") ? true : false
          let unzip = RED.util.evaluateNodeProperty(node.unzipConfig, node.unzipType, node, msg)
          // only allow boolean true or string "true" to be true
          unzip = (unzip === true || unzip === "true") ? true : false
          let prefix = RED.util.evaluateNodeProperty(node.prefixConfig, node.prefixType, node, msg)
          let start = msg.start
          let end = msg.end
          if (start && !end) {
            // start provided but not end, so provide end in the future
            end = "2050-01-01T00:00:00Z"
          }

          async function clearBackupFolder() {
            //node.log(`Emptying ${folder}`)
            node.status(clearingStatus)
            let files = [];
            try {
              files = await readdirP(folder);
            } catch {
              // ignore errors in readdir as probably folder does not exist
            }
            const regex = /[.](manifest|meta|tar|tar[.]gz)$/
            // select matching files only
            files = files.filter(f => regex.test(f))
            // delete them
            // can't(?) use map as need to call await at this level
            for (let i=0; i<files.length; i++) {
                await unlinkP(`${folder}/${files[i]}`)
            }
          }

          function doBackup(msg) {
              node.status(runningStatus)
              let cmd = `influxd backup -portable`
              if (database && database.length > 0) {
                cmd += ` -database ${database}`
              } 
              cmd += ` -host ${host}:${port}`
              if (start) {
                cmd += ` -start ${start}`
              }
              if (end) {
                cmd += ` -end ${end}`
              }
              cmd += ` ${folder}`
              //node.log (cmd)
              let childProcess = spawn(cmd, [], execOpt)
              currentProcess = childProcess
              restartWatchdog()
              childProcess.stdout.on('data', function (data) {
                  let msg2 = RED.util.cloneMessage(msg)
                  msg2.payload = data.toString()
                  // if this is a good progress record (contains "shard=") then restart the watchdog
                  if (msg2.payload.includes("shard=")) {
                      restartWatchdog()
                  }
                  send(msg2);
              });
              childProcess.stderr.on('data', function (data) {
                  let msg2 = RED.util.cloneMessage(msg)
                  msg2.topic = "stderr"
                  msg2.payload = data.toString()
                  send([null, msg2]);
                  // don't set return code failed as it may not be a permanent error
              });
              
              return childProcess
          }
          
          async function unzipFiles() {
              node.status(unzippingStatus)
              let files = await readdirP(folder);
              const regex = /\d{8}T\d{6}Z.*[.]tar[.]gz$/
              // select matching files only
              files = files.filter(f => regex.test(f))
              // unzip them
              // can't(?) use map as need to call await at this level
              for (let i=0; i<files.length; i++) {
                // read file
                let data = await readFileP(`${folder}/${files[i]}`)
                // unzip
                let out = new Buffer.from(pako.inflate(data));
                let outFile = files[i].slice(0,-3)
                // replace the date section with the prefix if provided
                if (prefix && prefix.length > 0) {
                  outFile = prefix + outFile.substring(16)
                }
                // write tar file
                await writeFileP(`${folder}/${outFile}`, out)
                // delete original
                await unlinkP(`${folder}/${files[i]}`)
              }
              // update manifest and meta if filenames changed
              if (prefix && prefix.length > 0) {
                // find the manifest file
                let files = await readdirP(folder);
                // rename the meta and manifest files
                let regex = /[.](manifest|meta)/
                files = files.filter(f => regex.test(f))
                if (files.length != 2) {
                  throw "Missing or extra manifest or meta files"
                }
                for (let i=0; i<files.length; i++) {
                  await renameP(`${folder}/${files[i]}`, `${folder}/${prefix}${files[i].substring(16)}`)
                }
                let mftFile = `${prefix}.manifest`
                // read the manifest, which should be json
                let data = await readFileP(`${folder}/${mftFile}`)
                // convert to object
                let manifest = JSON.parse(data)
                // change the filenames
                manifest.meta.fileName = prefix + manifest.meta.fileName.substring(16)
                manifest.files.map(function(file) {
                  file.fileName = prefix + file.fileName.substring(16)
                  return file
                });
                // rewrite the manifest file
                await writeFileP(`${folder}/${mftFile}`, JSON.stringify(manifest, null, 2))
              }
          }

          async function doIt() {
              if (clearfolder) {
                  await clearBackupFolder()
              } else {
              }
              await doBackup(msg)
              // backup finished so clear the process and stop the timer
              currentProcess = null;
              stopWatchdog()
              if (unzip) {
                  await unzipFiles()
              }
          }

          doIt()
          .catch(function (err) {
              //node.log("Caught")
              node.status(errorStatus)
              let msg2 = RED.util.cloneMessage(msg)
              msg2.topic = "catch"
              msg2.payload = err
              send([null, msg2, null])
              returnCode = 1    // indicates error
              errorDetails = err
          })
          .finally(function() {
              node.log("Finally")
              if (!errorDetails) {
                node.status(waitingStatus)
              }
              let msg2 = RED.util.cloneMessage(msg)
              msg2.payload = {code: returnCode}   // 0 is ok, 1 is failure
              send([null, null, msg2])
              stopWatchdog()
              if (done) {
                done(errorDetails)    // will be null if no error
              }
              else {
                if (errorDetails) {
                  node.error( errorDetails, msg )
                }
              }
              // shift this message off the front of the queue, with test just in case on close
              // has somehow been called so the queue may already be empty
              if (msgQueue.length > 0) {
                msgQueue.shift()
                node.log("Shifted " + msgQueue.length)
              } else {
                node.log("Not shifting, already empty")
              }
              // see if any more to do
              if (msgQueue.length > 0) {
                // start the next one
                node.log("handling next one")
                handleMessage(msgQueue[0].thisMsg, msgQueue[0].thisSend, msgQueue[0].thisDone)
              } else {
                node.log( "all done")
              }
          });

          send(null);
        } 
        function restartWatchdog() {
            stopWatchdog()
            watchdogTimer = setTimeout( watchdogEvent, 30000 )   // trigger event after 30 seconds
        }
        
        function stopWatchdog() {
          //node.log("stopping watchdog")
          if (watchdogTimer) {
              //node.log("about to clear")
              clearTimeout(watchdogTimer)
              watchdogTimer = null
              //node.log("watchdog stopped")
          }
        }
        
        function watchdogEvent() {
            // the watchdog has run down, kill the backup task if still running
            if (currentProcess) {
                node.log("killing")
                currentProcess.kill()
                currentProcess = null
            }
        }
    }

    RED.nodes.registerType("influxdb backup",InfluxBackupNode);
}
