// Imports global types
import "@twilio-labs/serverless-runtime-types";
// Fetches specific types
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from "@twilio-labs/serverless-runtime-types/types";

import got from "got";

/*
 ** Receives a recordingStatusCallback and calls our transcription service
 ** Requires you to define out an EIP service SID in your env variables (EIP_SERVICE_SID).
 ** Requires you to install got as a dependency for HTTP requests
 */

type MyEvent = {
  RecordingStatus: string;
  CallSid: string;
  RecordingChannels: string;
  RecordingSid: string;
};

type MyContext = {
  EIP_SERVICE_SID: string;
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
};

type MyGotResponse = {
  code: any;
  message: any;
  sid: string;
};

export const handler: ServerlessFunctionSignature<MyContext, MyEvent> =
  async function (
    context: Context<MyContext>,
    event: MyEvent,
    callback: ServerlessCallback
  ) {
    console.log(JSON.stringify(event, null, "  "));

    // Ignore events for recordings that aren't completed
    if (event.RecordingStatus !== "completed") {
      console.log(
        `[${event.CallSid}] Ignoring event - status: ${event.RecordingStatus}`
      );
      return callback(null);
    }

    // Ignore mono-channel recordings, because we need diarised recordings for our API
    if (event.RecordingChannels !== "2") {
      console.log(`[${event.CallSid}] Ignoring event - mono-channel`);
      return callback(null);
    }

    /*
     ** You can insert custom logic here to decide if a recording should be processed.
     ** You can pass data to this function by putting additional params in the querystring
     ** Those params get parsed into the Event object
     **
     ** For example, you could pass FromCountry from our TwiML request or Studio and use it
     ** to limit transcriptions to calls from an individual country.
     **
     ** if(event.FromCountry!=="US"){
     **   console.log(`[${event.CallSid}] Ignoring event - Non-US Caller`);
     **   return callback(null);
     ** }
     */

    // Since the EIP APIs are not public, we do not currently have helper-lib support
    try {
      console.log(
        encodeURIComponent(
          JSON.stringify([
            {
              channel: 2,
              type: "agent",
            },
          ])
        )
      );

      let uri = `https://ai.twilio.com/v1/Services/${context.EIP_SERVICE_SID}/Transcripts`;
      const res = await got.post<MyGotResponse>(uri, {
        form: {
          RecordingSid: event.RecordingSid,
          Participants: JSON.stringify([
            {
              channel: 2,
              type: "customer",
            },
            {
              channel: 1,
              type: "agent",
            },
          ]),
        },
        username: context.ACCOUNT_SID,
        password: context.AUTH_TOKEN,
        responseType: "json",
      });

      // We return a 201 upon successful resource creation
      if (res.statusCode !== 201)
        throw new Error(
          `POST /Transcripts sent ${res.body.code}: ${res.body.message}`
        );

      console.log(
        `[${event.CallSid}] Created transcript ${res.body.sid} for ` +
          event.RecordingSid
      );
      return callback(null);
    } catch (e) {
      console.error(
        `[${event.CallSid}] Failed to create transcription for ` +
          event.RecordingSid
      );

      console.error(e);
      return callback(
        `[${event.CallSid}] Failed to create transcription for ` +
          event.RecordingSid
      );
    }
  };
