//import all needed modules from node_modules
const express = require('express')
const app = express();
var jsreport = require('jsreport');
var fs = require('fs');
var cors = require('cors')
const puppeteer = require('puppeteer');
const {
  BigQuery
} = require('@google-cloud/bigquery');
const nodemailer = require("nodemailer");
var cron = require('node-cron');
var admin = require('firebase-admin');
var serviceAccount = require("./firebasecredentials.json");
var initJSReport = require('jsreport')().init();
var jsftp = require('jsftp');


//instruct js.report to look for assets in the local folder
(require('jsreport-assets')({
  searchOnDiskIfNotFoundInStore: true,
  allowedFiles: '**/*.*'
}))

//initialize firebase with admin credentials
var firebaseapp = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://boomin-3f5a2.firebaseio.com"
});

//set bigquery options object
const bqoptions = {
  keyFilename: './cloudcredentials.json',
  projectId: 'boomin-3f5a2',
};

//initialize bigquery with options from above
const bigquery = new BigQuery(bqoptions);


let exitCount = 0;
let enterCount = 0;

//initialize a list that is going to store all references to the cron schedules being run in the project
let cronList = [];

// configure express to accept JSON formatted data, and also allow CORS from all domains
app.use(express.json({
  limit: '256MB'
}));

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*"); // update to match the domain you will make the request from
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use(cors({
  credentials: true
}));



const Ftp = new jsftp({
  host: "ftp.just-in.co.za",
  port: 21, // defaults to 21
  user: "codecronie@just-in.co.za", // defaults to "anonymous"
  pass: "theappwarehouserocks" // defaults to "@anonymous"
});

// configure express to listen on the environemnt port, or if not available on port 3000
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
  // After beginning to listen on port, fire the main method
  main();
})

// simultaneaously, pass all required modules to the other javascript files that need them
require('./query')(app, bigquery);
require('./report')(app, initJSReport, jsreport, fs);


function main() {

  // reference the schedule node and listen for any changes continously
  firebaseapp.database().ref('schedule').on('value', (Snapshot) => {
    // if cron schedules exist loop through and stop each before starting new schedules to avoid overlap
    if (cronList.length > 0) {
      cronList.forEach((item, pos) => {
        item.destroy();
        console.log("destroy cron")
        if (pos === cronList.length - 1) {
          cronList = [];
          sitesList = [];
          intervalList = [];
          recipientsList = [];
          Snapshot.forEach((item) => {
            let obj = item.val();
            // start cron using Johannesburg timezone
            this["marker_" + obj.siteUID] = cron.schedule(obj.interval, () => {
              console.log('running a task every so often for ' + obj.display_name + '.');
              run(obj.siteUID, obj.display_name, obj.recipients, obj.report_length)
            }, {
              timezone: "Africa/Johannesburg"
            });
            this["marker_" + obj.siteUID].start();
            console.log('start cron');
            cronList.push(this["marker_" + obj.siteUID])

          })
        }
      })
    } else {
      sitesList = [];
      intervalList = [];
      recipientsList = [];
      Snapshot.forEach((item) => {
        let obj = item.val();
        // start cron using Johannesburg timezone
        this["marker_" + obj.siteUID] = cron.schedule(obj.interval, () => {
          console.log('running a task every so often for ' + obj.display_name + '.');
          run(obj.siteUID, obj.display_name, obj.recipients, obj.report_length)
        }, {
          timezone: "Africa/Johannesburg"
        });
        this["marker_" + obj.siteUID].start();
        console.log('start cron');
        cronList.push(this["marker_" + obj.siteUID])

      })
    }


  })
}

function run(site, sitename, recipients, length) {
  exitCount = 0;
  enterCount = 0;
  let start;
  let end;

  // check and set timeframe for query to bigquery
  if (length === 'Today') {
    //set date to CAT to ensure that wherever the service is hosted you query using local (SA) time
    let startdate = new Date() //.toLocaleString("en-ZA", {timeZone:"Africa/Johannesburg"})
    let enddate = new Date()
    startdate.setHours(00)
    startdate.setMinutes(00)
    startdate.setSeconds(00)
    enddate.setHours(23)
    enddate.setMinutes(59)
    enddate.setSeconds(59)
    start = startdate;
    end = enddate
  }
  if (length === 'Previous Day') {
    //set date to CAT to ensure that wherever the service is hosted you query using local (SA) time
    let initialDate = new Date().setDate(new Date().getDate() - 1)//.toLocaleString("en-ZA", {timeZone:"Africa/Johannesburg"});
    let startdate = new Date(initialDate)
    let enddate = new Date(initialDate)
    startdate.setHours(00)
    startdate.setMinutes(00)
    startdate.setSeconds(00)
    enddate.setHours(23)
    enddate.setMinutes(59)
    enddate.setSeconds(59)
    start = startdate;
    end = enddate
  }
  if (length === 'Weekly Report') {
    //set date to CAT to ensure that wherever the service is hosted you query using local (SA) time
    let initialDate = new Date().setDate(new Date().getDate() - 7)//.toLocaleString("en-ZA", {timeZone:"Africa/Johannesburg"});
    let startdate = new Date(initialDate)
    let enddate = new Date()
    startdate.setHours(00)
    startdate.setMinutes(00)
    startdate.setSeconds(00)
    enddate.setHours(23)
    enddate.setMinutes(59)
    enddate.setSeconds(59)
    start = startdate;
    end = enddate
  }

  //run query and wait for results
  runQuery(site, start, end).then((data) => {
    // declare string to later concatenate to the html to produce a table of results
    let masterString = ""
    data.sort(function (a, b) {
      return new Date(a.f0_).getTime() - new Date(b.f0_).getTime()
    });
    data.forEach((result, pos) => {
      if (result.exit_device_name) {
        exitCount++;
      }

      if (result.device_name) {
        enterCount++;
      }

      // construct data and and time information
      let entrydate = new Date(result.f0_).getDate() + '/' + (new Date(result.f0_).getMonth() + 1) + '/' + new Date(result.f0_).getFullYear()
      let entryTime = new Date(result.f0_).toLocaleTimeString();
      let exitdate;
      let minsOnSite;
      let exitTime;
      //split vehicle details to show on page line by line
      let VehicleDetailsSplit = result.VehicleDetails.split("/")
      result.VehicleDetailsSplit = VehicleDetailsSplit
      //if there is no exit date/time
      if (!result.f1_) {
        exitdate = "No Data"
        minsOnSite = "No Data"
        exitTime = "No Data"
      }
      //if the exit time is present 
      else {
        exitdate = new Date(result.f1_).getDate() + '/' + (new Date(result.f1_).getMonth() + 1) + '/' + new Date(result.f1_).getFullYear()
        minsOnSite = Math.floor(((new Date(result.f1_) - new Date(result.f0_)) / 1000) / 60)
        exitTime = new Date(result.f1_).toLocaleTimeString('en-GB');
      }

      if (!result.device_name) {
        result.DriverDetails = "No Device Data"
      }
      //if there are no exit device details
      if (!result.exit_device_name) {
        result.exit_device_name = "No Device Data"
      }
      //if there are no driver details
      if (!result.DriverDetails) {
        result.DriverDetails = "No Driver Data"
      }
      //if there are no exit driver details
      if (!result.exit_DriverDetails) {
        result.exit_DriverDetails = "No Driver Data"
      }
      //if there are no exit vehicle details
      if (!result.exit_VehicleDetails) {
        result.exit_VehicleDetails = "No Vehicle Data"
      }
      //if there is no exit driver card url, replace with placeholder image
      if(!result.exit_driver_card_photo_url){
        result.exit_driver_card_photo_url = "https://via.placeholder.com/150"
      }

      if(!result.driver_card_photo_url){
        result.driver_card_photo_url = "https://via.placeholder.com/150"
      }
      
        //concatenate results
        //if there is no driver data, use driver details object, else use the split list to show line by line
        if(result.DriverDetails === "No Driver Data"){
          masterString = masterString.concat(`
          <tr>
            <td style="vertical-align: top; text-align: left">
                <strong>` + result.device_name + `</strong>
            </td>
            <td style="vertical-align: top; text-align: left">
                Entry
            </td>
            <td style="vertical-align: top; text-align: left">
            `   + entrydate + `
            </td> 
            <td style="vertical-align: top; text-align: left">
            `   + entryTime + `
            </td>
            <td rowspan="2" style="vertical-align: top; text-align: left">
            `   + minsOnSite + `
            </td>
            
            <td style="vertical-align: top; text-align: left" class="format-multiline">`+ result.VehicleDetails +`</td>
            
            <td style="vertical-align: top; text-align: left" class="format-multiline">`+ result.DriverDetails + `</td>
            <td><img src=`+ result.driver_card_photo_url +` style="width: 80px"></td>
          </tr>
          <tr>
            <td style="vertical-align: top; text-align: left">
              <strong>` + result.exit_device_name + `</strong>
            </td>
            <td style="vertical-align: top; text-align: left">
              Exit
            </td>
            <td style="vertical-align: top; text-align: left">
            ` + exitdate + `
            </td>
            <td style="vertical-align: top; text-align: left">
            ` + exitTime + `
            </td>
            <td style="vertical-align: top; text-align: left" class="format-multiline">`+ result.exit_VehicleDetails +`</td>                    
            <td style="vertical-align: top; text-align: left" class="format-multiline">` + result.exit_DriverDetails +`</td>
            <td><img src=`+result.exit_driver_card_photo_url+` style="width: 80px"></td>
          </tr>`)
        }
        else{

          //not sure if this else bloc serves a purpose might need to remove this 
          //Ishe
          //29 Jan 2020
          masterString = masterString.concat(`
          <tr>
            <td style="vertical-align: top; text-align: left">
                <strong>` + result.device_name + `</strong>
            </td>
            <td style="vertical-align: top; text-align: left">
                Entry
            </td>
            <td style="vertical-align: top; text-align: left">
            ` + entrydate + `
            </td>
            <td style="vertical-align: top; text-align: left">
            ` + entryTime + `
            </td>
            <td rowspan="2" style="vertical-align: top; text-align: left">
            ` + minsOnSite + `
            </td>
            <td style="vertical-align: top; text-align: left" class="format-multiline">`+ result.VehicleDetails +`</td>
            <td style="vertical-align: top; text-align: left" class="format-multiline">`+ result.DriverDetails+ `</td>
            <td><img src=`+result.driver_card_photo_url+` style="width: 80px"></td>
          </tr>
          <tr>
            <td style="vertical-align: top; text-align: left">
              <strong>` + result.device_name + `</strong>
            </td>
            <td style="vertical-align: top; text-align: left">
                Exit
            </td>
            <td style="vertical-align: top; text-align: left">
            ` + exitdate + `
            </td>
            <td style="vertical-align: top; text-align: left">
            ` + exitTime + `
            </td>
            <td style="vertical-align: top; text-align: left" class="format-multiline">`+ result.exit_VehicleDetails + `</td>            
            <td style="vertical-align: top; text-align: left" class="format-multiline">`+ result.exit_DriverDetails+ `</td>
            <td><img src=`+result.exit_driver_card_photo_url+` style="width: 80px"></td>
          </tr>`)
        }


      if (pos === data.length - 1) {
        //when complete, generate report
        generateReport(masterString, sitename, site, recipients, start, end);
      }
    })
  })

}

async function runQuery(site, start, end) {

  const query = "SELECT CAST((EntryDateTime) AS STRING),CAST((ExitDateTime) AS STRING), " +
        "driver_card_photo_url, exit_driver_card_photo_url, exit_driver_name, exit_driver_id_no, " +
        "entry_hour, entry_minute, exit_hour, exit_minute, device_name, exit_device_name, " +
        "VehicleDetails, exit_VehicleDetails, DriverDetails, exit_DriverDetails, site_name " + 
        "FROM `boomin-3f5a2.JustIN.in_out_report` " + 
        "WHERE site_id = '" + site + "' " +
        "AND (entry_time BETWEEN TIMESTAMP_SECONDS(" + Math.floor(start / 1000) + ") " + 
        "AND TIMESTAMP_SECONDS(" + Math.floor(end / 1000) + ")) limit 1000"

  // For all options, see https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query
  const options = {
    query: query,
    // Location must match that of the dataset(s) referenced in the query.
    location: 'US',
  };

  // Run the query as a job
  let [job] = await bigquery.createQueryJob(options);

  const [rows] = await job.getQueryResults();

  // Print the results
  let results = []
  rows.forEach(row => {
    results.push(row);
  });

  return results;
}

function generateReport(masterString, sitename, site, recipients, start, end) {

  try{

      console.log('Report Generation Fired... here');
      // set options for date formatting using tolocale
      let options = {
        weekday: 'short',
        year: 'numeric',
        month: 'long',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      };

      // jsreport renders page, making use of headless-chrome and puppeteer***
      jsreport.render({
        template: {
          content: `<html>
            <head>
              <meta content="text/html; charset=utf-8" http-equiv="Content-Type">
              <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/metro/4.1.5/css/metro.min.css">
              <script src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/2.7.2/Chart.min.js'></script>

              <link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css" 
              integrity="sha384-ggOyR0iXCbMQv3Xipma34MD+dH/1fQ784/j6cY/iJTQUOhcWr7x9JvoRxT2MZw1T" crossorigin="anonymous">


            <style>
            @font-face {
              font-family: 'OpenSans-Regular';
              font-style: normal;
              font-weight: 400;
              font-display: swap;
              src: local('Open Sans Regular'), local('OpenSans-Regular'), url(https://fonts.gstatic.com/s/opensans/v17/mem8YaGs126MiZpBA-UFVZ0b.woff2) format('woff2');
              unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
            }
            .format-multiline{
              white-space: pre-line;
            }
            th{
              vertical-align:top
            }
            </style>

            </head>
            <body>
                    <div style="margin:20px">
                            <div class="row">
                              <div class="col-9">
                                <h1>` + sitename + ` Report</h1>
                                <h4>Date Range: ` + new Date(start).toLocaleDateString('en-GB', options) + ` - ` + 
                                new Date(end).toLocaleDateString('en-GB', options) + `</h4>
                              </div>
                              <div class="col-3" style="text-align: right;">
                                <img src="{#asset JustInByAmatec.png @encoding=dataURI}" style="width: 100px;">
                              </div>
                            </div>
                          </div>
                                  
                        <div style="margin: 20px">
                                <table class='table striped'>
                                        <thead>
                                            <tr>
                                                <th>Device</th>
                                                <th>Event Type</th>
                                                <th>Event Date</th>
                                                <th>Event Time</th>
                                                <th>Minutes On Site</th>
                                                <th>Vehicle Details</th>
                                                <th>Driver Details</th>
                                                <th>Driver Photo</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ` + masterString + `
                                        </tbody>
                                    </table>
                        </div>
                        
                        <div style="margin: 20px">
                            <table class='table striped'>
                            <tr>
                              <td>
                                <h1>
                                  Total Entries
                                </h1>
                              </td>
                              <td>
                                <h1>
                                  ` + enterCount + `
                                </h1>
                              </td>
                              <td>
                                <h1>
                                  Total Exits
                                </h1>
                              </td>
                              <td>
                                <h1>
                                  ` + exitCount + `
                                </h1>
                              </td>
                            <tr>
                            </table>
                          </div>
            </body>
          </html>`,
          engine: 'handlebars',
          recipe: 'chrome-pdf'
        },
        data: {
          foo: "world"
        }
        
      }).then((resp) => {
        // write report buffer to a file stored in the folder
        let reportDate = new Date();
        let timestamp = reportDate.getTime()
        let reportname = "" + sitename + "_Report_" + timestamp + ".pdf"
        // save the file
        /*try {
          fs.writeFileSync("c:/projects/" + reportname, resp.content);
        } catch (error) {
          console.log(error);
        }*/

        Ftp.put(resp.content, "/public_html/pdfreports/" + reportname, err => {
          if (!err) {
            // send the saved file to all recipients
            sendMail(reportname, recipients, sitename, new Date(start).toLocaleDateString('en-GB', options), 
            new Date(end).toLocaleDateString('en-GB', options),reportname);
            console.log("File transferred successfully!");
          }
          else
          {
            console.log(err)
          }
        });
      }
      );
  }
  catch(e)
  { 
    console.log(e.stack)
  }
}

async function sendMail(reportname, recipients, sitename, start, end, remotefile) {

  try
  {
    // create reusable transporter object using the default SMTP transport
    console.log('Mail sending fired for site: '+sitename+'')
    let remotelink = "http://www.just-in.co.za/pdfreports/" + remotefile
    let transporter = nodemailer.createTransport({
      host: "mail.just-in.co.za",
      port: 587,
      secure: false, // true for 465, false for other port
      auth: {
        user: 'reporting@just-in.co.za', // generated ethereal user
        pass: '1g1w6rdlim' // generated ethereal password
      },
      tls: {
        secure: false,
        ignoreTLS: true,
        rejectUnauthorized: false
        }
    });

    let info = await transporter.sendMail({
      from: 'reporting@just-in.co.za', // sender address
      to: recipients, // list of receivers
      subject: sitename + " | In And Out Report", // Subject line
      html:"<h2>In Out Report</h2><p>" + 
      "Your report for " + sitename +", date range <strong>" + start + "</strong> to <strong>" + end +
      "</strong> has been created and is ready for you to download. <a href='" + remotelink + 
      "'>Click here</a> to download, if the like does not work copy and poast the " +
      "text below into your browser<br>" + remotelink + "</p>" +
      "<p>Please note that your report will be deleted after 7 days</p>" +
      "<p><strong>Kind Regards<br>Just-In Reporting</strong></p>" // html body
    });

    console.log("Message sent: %s", info.messageId);
  }
  catch(e)
  {
    console.log("Error sending email")
    console.log(e.stack)
  }

}
