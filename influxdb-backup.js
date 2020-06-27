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
    var PromisifyChildProcess = require('promisify-child-process');
    const { exec, spawn/*, fork, execFile*/ } = PromisifyChildProcess;
    const execOpt = {encoding: 'binary', maxBuffer: 10000000, shell: '/bin/bash'}
        
    function InfluxBackupNode(config) {
        RED.nodes.createNode(this,config);
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
        
        // Save "this" object
        let node = this;

            
            node.currentProcess = null;
            node.watchdogTimer = null;

        node.on('input', function(msg, send, done) {

          // If this is pre-1.0, 'send' will be undefined, so fallback to node.send
          send = send || function() { node.send.apply(node,arguments) }          
    
          let currentProcess = null;
          let watchdogTimer = null;
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
          let start = msg.start
          let end = msg.end
          if (start && !end) {
            // start provided but not end, so provide end in the future
            end = "2050-01-01T00:00:00Z"
          }
          async function doIt() {
              if (clearfolder) {
                  await clearBackupFolder()
                  console.log("cleared")
              } else {
                  console.log("skipping clear")
              }
              await doBackup(msg)
              console.log("done backup")
              stopWatchdog()
              if (unzip) {
                  await unzipFiles()
                  console.log("Unzipped")
              } else
              {
                  console.log("skipping unzip")
              }
          }
          doIt()
          .catch(function (err) {
              console.log("Caught")
              node.status({text: "Error"})
              let msg2 = RED.util.cloneMessage(msg)
              msg2.topic = "catch"
              msg2.payload = err
              send([null, msg2, null])
              returnCode = 1    // indicates error
              errorDetails = err
          })
          .finally(function() {
              node.status({text: ""})
              console.log("Finally")
              let msg2 = RED.util.cloneMessage(msg)
              msg2.payload = {code: returnCode}   // 0 is ok, 1 is failure
              send([null, null, msg2])
              stopWatchdog()
              if (done)
                done(errorDetails)    // will be null if no error
              else {
                if (errorDetails) {
                  node.error( errorDetails, msg )
                }
              }
          });

          send(null);
            
          function clearBackupFolder() {
              console.log(`Emptying ${folder}`)
              node.status({text: "Emptying Folder"})
              // filenames should start yyyymmddThhmmssZ.
              // this needs bash, but we have ensured that in the exec opts
              return exec(`rm -f ${folder}/????????T??????Z*.{manifest,meta,tar,tar.gz}`, execOpt)
          }
          
          function doBackup(msg) {
              console.log(`Backup -database ${database} -host ${host}:${port} ${folder}`)
              node.status({text: "Running Backup"})
              let cmd = `influxd backup -portable -database ${database} -host ${host}:${port}`
              if (start) {
                cmd += ` -start ${start}`
              }
              if (end) {
                cmd += ` -end ${end}`
              }
              cmd += ` ${folder}`
              //console.log (cmd)
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
                  send(msg2);         // Clone?
              });
              childProcess.stderr.on('data', function (data) {
                  let msg2 = RED.util.cloneMessage(msg)
                  msg2.topic = "stderr"
                  msg2.payload = data.toString()
                  console.log("backup stderr")
                  send([null, msg2]);
                  // don't set return code failed as it may not be a permanent error
              });
              
              return childProcess
          }
          
          function unzipFiles() {
              console.log("Unzipping")
              node.status({text: "Unzipping Files"})
              return exec(`gunzip ${folder}/*.tar.gz`, execOpt)
          }
          
          function restartWatchdog() {
              stopWatchdog()
              watchdogTimer = setTimeout( watchdogEvent, 30000 )   // trigger event after 5 seconds
          }
          
          function stopWatchdog() {
              //node.log("stopping watchdog")
              if (watchdogTimer) {
                  clearTimeout(watchdogTimer)
                  watchdogTimer = null
                  //node.log("stopped")
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
        });
                
        
    }
    RED.nodes.registerType("influxdb backup",InfluxBackupNode);
}
