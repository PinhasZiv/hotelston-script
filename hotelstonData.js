const axios = require('axios');
const json2csv = require('json2csv');
const parser = require('xml2json');
const fs = require('fs');
const _ = require('lodash');
const decrypt = require('./decrypt');

const requestURL = "http://www.hotelston.com/ws/StaticDataServiceV2/StaticDataServiceHttpSoap12Endpoint/";

const encryptedLoginData = "6002f7dcc4411698a85763938675f017ccccd8cc5af5f0219d493c843fb473a0d82e78feced17cd9bc115f2263c135d090d86b44db30568c73c9d88d8fd0e30f369f064aaac990ec1f9ada55a3fe8e5e";
const loginData = JSON.parse(decrypt.decryptLoginData(encryptedLoginData));
const config = {
    headers: {
        'SOAPAction': 'getHotelList',
        'Content-Type': 'text/plain'
    }
};

const hotelListRequestBody =
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:xsd="http://request.v2.staticdataservice.ws.hotelston.com/xsd" xmlns:xsd1="http://types.v2.staticdataservice.ws.hotelston.com/xsd">
    <soap:Header/>
    <soap:Body>
        <xsd:HotelListRequest>
            <xsd1:loginDetails xsd1:email="${loginData.email}" xsd1:password="${loginData.password}"/>
        </xsd:HotelListRequest>
    </soap:Body>
    </soap:Envelope>`;

// creating the request to get hotels list
async function makeHotelListRequest() {
    let allHotelsJson;
    let allHotels;
    const hotelsList = await axios.post(requestURL, hotelListRequestBody, config)
        .then(resp => {
            allHotels = resp.data;
        }).catch(err => { console.log(err.response) });
    return allHotels;
};

// send getHotelsList request and receive all hotelston hotels list
async function getHotelsList() {
    let hotelsList = [];
    const allHotels = await makeHotelListRequest();
    const allHotelsJsonString = parser.toJson(allHotels);
    const allHotelsJson = JSON.parse(allHotelsJsonString);
    const countries = allHotelsJson['soapenv:Envelope']['soapenv:Body']['xsd:HotelListResponse']['xsd:country'];
    for (country of countries) {
        if ("xsd:state" in country) {
            const states = Array.isArray(country['xsd:state']) ? country['xsd:state'] : [country['xsd:state']];
            for (state of states) {
                const cities = Array.isArray(state['xsd:city']) ? state['xsd:city'] : [state['xsd:city']];
                for (city of cities) {
                    hotelsList = hotelsList.concat(city['xsd:hotel']);
                }
            }
        } else {
            const cities = Array.isArray(country['xsd:city']) ? country['xsd:city'] : [country['xsd:city']];
            for (city of cities) {
                hotelsList = hotelsList.concat(city['xsd:hotel']);
            }
        }
    }
    return hotelsList;
}

async function getHotelData(hotelId) {
    const requestHeaders = {
        headers: {
            'SOAPAction': 'getHotelDetails',
            'Content-Type': 'text/xml'
        }
    };

    const requestBody = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://request.v2.staticdataservice.ws.hotelston.com/xsd" xmlns:xsd1="http://types.v2.staticdataservice.ws.hotelston.com/xsd">
    <soapenv:Header/>
    <soapenv:Body>
        <xsd:HotelDetailsRequest>
            <xsd1:loginDetails xsd1:email="${loginData.email}" xsd1:password="${loginData.password}"/>
            <xsd:hotelId>${hotelId}</xsd:hotelId>
        </xsd:HotelDetailsRequest>
    </soap:Body>
</soap:Envelope>`;

    return axios.post(requestURL, requestBody, requestHeaders)
        .then(resp => {
            const hotelData = resp.data;
            const hoteldetailsInJsonString = parser.toJson(hotelData);
            const jsonDetails = JSON.parse(hoteldetailsInJsonString);
            const hotelJson = jsonDetails["soapenv:Envelope"]["soapenv:Body"]["xsd:HotelDetailsResponse"]["xsd:hotel"];
            if (hotelJson && jsonDetails['soapenv:Envelope']['soapenv:Body']['xsd:HotelDetailsResponse']['xsd1:success']['$t'] === 'true') {
                log('pullSuccess', hotelId);
                const hotelParsedData = parseHotelDetails(hotelJson);
                return hotelParsedData;
            } else {
                const errorDetails = jsonDetails['soapenv:Envelope']['soapenv:Body']['xsd:HotelDetailsResponse']['xsd1:error']
                log('pullError', hotelId, errorDetails);
                AddHotelToFailedList(hotelId, errorDetails);
                return undefined; // need to check if better to return something else
            }
        });
};

function parseHotelDetails(details) {
    const data = {
        id: _.get(details, "xsd1:id"),
        name: _.get(details, "xsd1:name"),
        country: _.get(details, "xsd:address.xsd1:country"),
        city: _.get(details, "xsd:address.xsd1:city"),
        address: _.get(details, "xsd:address.$t"),
        latitude: _.get(details, "xsd:coordinates.xsd1:latitude"),
        longitude: _.get(details, "xsd:coordinates.xsd1:longitude"),
        zip: _.get(details, "xsd:address.xsd1:zip"),
        phone: _.get(details, "xsd:phone", ""),
        email: _.get(details, "xsd:email", "")
    }
    return data;
};

function log(type, hotelId = 0, error = 0) {
    const logsFilePath = "./script-files/hotelstonLogsProd.JSON";

    let message = "";
    switch (type) {
        case 'pullSuccess':
            message = `Data of hotel ${hotelId} was received successfully.`;
            break;
        case 'pullError':
            message = `Failed to receive information of hotel ${hotelId}.`;
            break;
        case 'writeSuccess':
            message = `Data was recorded successfully to csv file.`;
            break;
        case 'writeError':
            message = `Unable to record the information in the CSV file.`;
            break;
    }

    const logObj = {
        type,
        hotelId,
        message,
        timestamp: new Date().toISOString(),
        error
    }

    fs.appendFileSync(logsFilePath, JSON.stringify(logObj) + '\n');
};

function AddHotelToFailedList(hotelId, error) {
    const failedHotelsFilePath = "./script-files/hotelsFailedProd.JSON";
    const failedHotelObj = {};
    const hotel = { hotelId, error };
    if (!fs.existsSync(failedHotelsFilePath)) {
        failedHotelObj[hotelId] = hotel;
        fs.writeFileSync(failedHotelsFilePath, JSON.stringify(hotel));
    } else {
        const failedHotels = fs.readFileSync("./script-files/hotelsFailedProd.JSON");
        const failedListObj = JSON.parse(failedHotels);
        failedListObj[hotelId] = hotel;
        fs.writeFileSync(failedHotelsFilePath, JSON.stringify(failedListObj));
    }
};

async function getAllHotelsData(hotelsList) {
    const hotelsData = [];
    let responsesList;
    for (let i = 0; i < hotelsList.length; i++) {
        // for (let i = 0; i < 1000; i++) { 
        const hotel = hotelsList[i];
        const hotelId = hotel['id'];
        hotelsData.push(getHotelData(hotelId));
        if ((i !== 0 && i % 4 === 0) || i === hotelsList.length - 1) { // API limit of 4 concurrent hotel details requests.
            responsesList = await Promise.all(hotelsData);
            addRowsToCsvFile(responsesList);
            hotelsData.length = 0;
        }
    }
    if (hotelsData.length > 0) {
        responsesList = await Promise.all(hotelsData);
        addRowsToCsvFile(responsesList);
    }
};

function addRowsToCsvFile(data) {
    const csvPath = './script-files/hotelsProd.csv';
    let rowData;
    for (let row of data) {
        if (row) {
            if (!fs.existsSync(csvPath)) {
                rowData = json2csv.parse(row, { header: true });
            } else {
                rowData = json2csv.parse(row, { header: false });
            }
            try {
                fs.appendFileSync(csvPath, rowData);
                fs.appendFileSync(csvPath, "\r\n");
                log('writeSuccess');
            } catch (error) {
                log('writeError', 0, error);
            }
        } else {
            log('writeError', 0, "hotel hasn't received properly");
        }
    }
};

async function readFileFromAWS(path) {
    let hotelsList;
    await axios.get(path).then(response => {
        hotelsList = response.data.hotels;
    });
    return hotelsList;
}

async function main() {
    const begin = new Date();
    // const hotelsList = await getHotelsList(); // using a request to hotelSton
    // const hotelsList = readXmlLocalFile();
    // fs.writeFileSync('/home/pinhas/Documents/PMS/Hotelston/onlyHotels.json', JSON.stringify(hotelsList));
    const hotelsListPath = "https://amadeus-hotels.s3.eu-central-1.amazonaws.com/hotelston-hotels/onlyHotels-formated.json?response-content-disposition=inline&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEGgaDGV1LWNlbnRyYWwtMSJHMEUCIE7PYpv9EySEHXgx4NTgTHABhnx%2Bi3hNw11UMG%2BvGlhmAiEA4APn6vu7Mn8OUidMELIKnH8tPz06TahZqelUlWw94N8qhAMI0f%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw3MjI4NjE1OTk2MDciDKo3X6irwF2Y08dcGSrYAnGLEP5a%2BuWM5QD8Y9888ZggbquyqsNMpMds%2FNk3nDbqUiLEX2HkONqaiuJUsjlkVuXqOVZTGQnxYWOGr90aTVoCsZ9RCEutoFn93MQd3eZxr0Euv12F1kVeikXU4UPyf9EWe9OgEVOOZhUB2FL1p5SHbZF2mWxCs%2BTtRIFppAh0TSVPySBe3Qz0NIc%2F2Cnz51u3HRXhr8TugWfMF782rsjbbkjkIEtBQlhCDYmkl1tOv%2F3Qt%2BLMfmV186ekNu0MpMoQeuyv7lMj9MrfcvaEgLmiTpgeyeesLmID7hL7Qk9eZKdtO0pbSOv73b0Mq302rj0ifKPvc%2BnKCOl0UvkpNLrOyOTvNRS73L6HuETXlpMnJ6D0O5QF5G%2BqTWnCjx9uw1Q95l96d2TLaHuFPTpWTkP99iTx6srEmDIJuYqtiaY3dtG%2BjBKMkvJXxo%2FQ1l71cn%2FiIkUXjNwRMNX0uJ4GOrMCPvu24n1N2JwhZ6K%2B6%2FqcomFBI45zqhiTbp3SEpr7M3AUJEviHwg1pknzmizM3N%2FNF9namUmwDu5Cid0tSouq75J7nYLMuSNIznvMfpY6wU2v767I3WsDwdaYAZnLn%2F%2Fu0zUzSUid7Ptt4ZhTpSN%2FEE9yc4zjdLQoL2Za0o9aIUZOMJXbBmRHPV5h440xdf8xWDQima6xq4Wr3a1cPyrq0oZMyNIw0%2FKudy%2BC0wxYsrHJfWIFDd%2BXFh%2Frf8vHuuRF29vElOnWlTF%2BfR3fD7H5AmWm5%2F5p%2FOROUxLwpMaQd6NZHwyUOnoXrLUtxZCYAh%2BBLOLAvGZX3Rb7oWjyYrSdFOxOAk7Umc%2B7UkyXs4wRte%2F4ghudm8FtvbvKvsY0bZs2TiHkMCaZqjdYXTMAUVOo6tCxpw%3D%3D&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20230123T082557Z&X-Amz-SignedHeaders=host&X-Amz-Expires=3600&X-Amz-Credential=ASIA2QTPIVN32GRPSJR7%2F20230123%2Feu-central-1%2Fs3%2Faws4_request&X-Amz-Signature=f2018182144bbce4b2498f2de5fbb855e2258c05eda32677ff866bdceadf6fab";
    const hotels = await readFileFromAWS(hotelsListPath);
    await getAllHotelsData(hotels);
    const end = new Date();
    const totalRunningTime = end - begin;
    console.log(getMinDiff(begin, end));
}

function getMinDiff(startDate, endDate) {
    const msInMinute = 60 * 1000;

    return Math.round(
        Math.abs(endDate - startDate) / msInMinute
    );
}

main();


// reading all hotels from xml file and convert it to array of hotels.
function readXmlLocalFile() {
    let hotelsList = [];
    // const file = '/home/pinhas/Documents/PMS/Hotelston/response-prod.xml';
    const file = '/home/pinhas/Documents/PMS/Hotelston/hotelsList.json';
    // hotelsList = await getAllHotelsFromXml(file);
    // const listInJsonString = parser.toJson(res);
    // fs.writeFileSync('/home/pinhas/Documents/PMS/Hotelston/hotelsList.json', listInJsonString);
    // const res = fs.readFileSync(file, 'utf-8');
    // const jsonList = JSON.parse(res);
    const jsonList = require(file);
    const countries = jsonList['soapenv:Envelope']['soapenv:Body']['HotelListResponse']['country'];
    for (country of countries) {
        if ("state" in country) {
            const states = Array.isArray(country['state']) ? country['state'] : [country['state']];
            for (state of states) {
                const cities = Array.isArray(state['city']) ? state['city'] : [state['city']];
                for (city of cities) {
                    if (_.isArray(city['hotel'])) {
                        for (hotel of city['hotel']) {
                            hotelsList.push(hotel);
                        }
                    } else {
                        hotelsList.push(city['hotel']);
                    }
                }
            }
        } else {
            const cities = Array.isArray(country['city']) ? country['city'] : [country['city']];
            for (city of cities) {
                if (_.isArray(city['hotel'])) {
                    for (hotel of city['hotel']) {
                        hotelsList.push(hotel);
                    }
                } else {
                    hotelsList.push(city['hotel']);
                }
            }
        }
    }
    console.log('success');
    return hotelsList;
}

