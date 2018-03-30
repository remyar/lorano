"use strict";

// Tested with a SODAQ ExpLoRer running ./lorano_test_abp.ino

const Link = require('..'),
      lora_comms = require('lora-comms'),
      aw = require('awaitify-stream'),
      { Model } = require('objection'),
      Knex = require('knex'),
      expect = require('chai').expect,
      path = require('path'),
      crypto = require('crypto');

let link, TestModel;

before(function ()
{
    const knex = Knex({
        client: 'sqlite3',
        useNullAsDefault: true,
        connection: {
            filename: path.join(__dirname, 'lorano.sqlite3')
        }
    });

    TestModel = class extends Model {};
    TestModel.knex(knex);
});

function start(cb)
{
    lora_comms.start_logging();
    lora_comms.log_info.pipe(process.stdout);
    lora_comms.log_error.pipe(process.stderr);
    lora_comms.start();
    link = new Link(TestModel, lora_comms.uplink, lora_comms.downlink);
    link.on('ready', cb);
    link.on('error', cb);
}

function stop(cb)
{
    if (!lora_comms.active)
    {
        return cb();
    }

    lora_comms.once('stop', cb);
    lora_comms.stop();
}
process.on('SIGINT', () => stop(() => {}));

function wait_for_logs(cb)
{
    if (!lora_comms.logging_active)
    {
        return cb();
    }

    lora_comms.once('logging_stop', cb);
    // no need to call lora_comms.stop_logging(), logging_stop will be emitted
    // once the log streams end
}

beforeEach(start);
afterEach(stop);
afterEach(wait_for_logs);

describe('echoing device with ABP', function ()
{
    this.timeout(60 * 60 * 1000);

    it('should receive same data sent', async function ()
    {
        const payload_size = 12;
        let duplex = aw.createDuplexer(link);
        let send_payload = crypto.randomBytes(payload_size);

        while (true)
        {
            let recv_data = await duplex.readAsync();
            if (recv_data.payload.length !== payload_size)
            {
                continue;
            }

            if (recv_data.payload.equals(send_payload))
            {
                // Shouldn't happen because send on reverse polarity
                console.error('Received packet we sent');
                continue;
            }

            if (recv_data.payload.compare(send_payload,
                                          payload_size/2,
                                          payload_size,
                                          payload_size/2,
                                          payload_size) === 0)
            {
                return;
            }

            send_payload = Buffer.concat([recv_data.payload.slice(0, payload_size/2),
                                          crypto.randomBytes(payload_size/2)]);
            recv_data.reply.payload = send_payload;
            await(duplex.writeAsync(recv_data.reply));
        }
    });
});
