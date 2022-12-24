const express = require("express")
const { v4: uuidv4 } = require('uuid');
const cors = require("cors")
const bodyParser = require("body-parser")
const axios = require("axios")
const fs = require("fs").promises
const fss = require("fs");
const { Configuration, OpenAIApi } = require("openai");
const csv = require('csv-parser')

const app = express()
const port = process.env.PORT || 3000
app.use(cors())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(express.json())

app.get('/', (req, res) => {
  res.status(404).send("WELCOME")
})

app.post('/create-open-ai-model', async (req, res) => {
  const data = req.body
  const dataKeys = Array.from(Object.keys(data))

  if (dataKeys.includes("estimate") && data['estimate'] == 'y') {

    var cond = false;
    cond = dataKeys.includes("csvUrl") && data['csvUrl'] != '' ? dataKeys.includes("model") && data['model'] != '' ? true : res.status(500).send({ 'error': "Model not provided" }) : res.status(500).send({ 'error': "CSV URL not provided" })

    if (cond == true) {
      const response = await axios.get(data['csvUrl'])
      const csv_data = await response.data

      const csv_character_length = csv_data.length
      const n_epochs = data['n_epochs'] ? data['n_epochs'] : 2

      var count = (csv_character_length / 4) * n_epochs

      var condi = true
      switch (data['model']) {
        case 'davinci':
          var n = 0.00003
          break;
        case 'curie':
          var n = 0.000003
          break;
        case 'babbage':
          var n = 0.0000006
          break;
        case 'ada':
          var n = 0.0000004
          break;
        default:
          condi = false
          res.status(500).send({ 'error': "Model is incorrect" })
          break;
        }

      if (condi == true) {
        count = count * n
        count = count.toFixed(2)
        console.log(count)
        if (count < 0.01) {
          res.status(200).send({ "estimate": `<$0.01` })
        } else {
          res.status(200).send({ "estimate": `~$${count}` })
        }
      }

    }

  } else {

    var cond = false;
    cond = dataKeys.includes("csvUrl") && data['csvUrl'] != '' ? dataKeys.includes("apiKey") && data['apiKey'] != '' ? dataKeys.includes("model") && data['model'] != '' ? true : res.status(500).send({ 'error': "Model not provided" }) : res.status(500).send({ 'error': "API key not provided" }) : res.status(500).send({ 'error': "CSV URL not provided" })
    if (cond == true) {

      if (!data['csvUrl'].includes('.csv')) {
        res.status(500).send({ 'error': "Invalid file format" })
      } else {
        var arr = []
        await axios.get(data['csvUrl'])
        .then(async response => {

          var header_splitted = response.data.replaceAll('\r', '').split('\n')

          if (header_splitted[0].includes('prompt') && header_splitted[0].includes('completion')) {
            const response = await axios.get(data['csvUrl'],{ responseType: "stream",});
            response.data
              .pipe(csv())
              .on("data", function (row) {
                arr.push(row);
              })
              .on("end", async function () {

                const arr2 = arr.map((item) => (
                  { 
                    prompt: item.prompt + "\n\n###\n\n",
                    completion: item.completion + "###"
                  }
                ))
  
                const filename = uuidv4() + '.jsonl';
                await fs.writeFile(filename, JSON.stringify(arr2).replaceAll('[', '').replaceAll(']', '').replaceAll('},{', '}\n{'))
  
                const configuration = new Configuration({
                  apiKey: data['apiKey'],
                });
                const openai = new OpenAIApi(configuration);
                await openai.createFile(
                  fss.createReadStream(filename),
                  "fine-tune"
                ).then(async responses => {

                  await openai.createFineTune({
                    training_file: responses.data.id,
                    model: data['model'],
                    n_epochs: data['n_epochs'] ? data['n_epochs'] : 2
                  }).then(response2 =>{
                    res.status(200).send({ "message": "Success", "id": response2.data.id })
                  }).catch(err => { res.status(401).send({ 'error': err.message }) });

                }).catch(err => { res.status(401).send({ 'error': err.message, message: "Invalid API key" }) });

                await fs.unlink(filename)

              })
              .on("error", function (error) {
                res.status(response.status).send({ 'error': response.error, 'message': "error reading CSV URL"  })
              });
  
          } else {
            res.status(500).send({ 'error': "Invalid column headers" })
          }

        }).catch(err => { res.status(403).send({ 'error': "CSV URL unreadable" }) });
        
      }
    }
  }
})

app.post('/open-ai-models', async (req, res) => {

    const data2 = req.body
    const dataKeys2 = Array.from(Object.keys(data2))

    if (dataKeys2.includes("apiKey")){

      try {

          const configuration = new Configuration({
            apiKey: data2['apiKey'],
          });
          const openai = new OpenAIApi(configuration);
          const latest_response = await openai.listFineTunes();
          
          if (latest_response.status != 200) {
              res.status(latest_response.status).send({ 'error': latest_response.error, 'message': "error from Open AI request" })
          } else {

              var result = latest_response.data.data.map( (item) => {

                var utcSeconds = item.created_at;
                var date = new Date(0);
                date.setUTCSeconds(utcSeconds);

                if (item.status == "failed") {
                  return {
                    id: item.id,
                    n_epochs: item.hyperparams.n_epochs,
                    model: item.model,
                    status: item.status,
                    created_at: date.toDateString(),
                    file_error: item.training_files[0].status_details,
                    fine_tuned_model: item.fine_tuned_model
                  };
                } else {
                  return {
                    id: item.id,
                    n_epochs: item.hyperparams.n_epochs,
                    model: item.model,
                    status: item.status,
                    created_at: date.toDateString(),
                    fine_tuned_model: item.fine_tuned_model
                  };
                }

              });

              res.status(200).send(result.reverse())
          }

      } catch(err) {
          res.status(401).send({ 'error': "Invalid Credentials (Incorrect API Key)" })
      }

    } else {
        res.status(500).send({ 'error': "No API key found" })
    }
})

app.listen(port, () => {
  console.log(`listening on PORT: ${port}`)
})