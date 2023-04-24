// Imports global types
import "@twilio-labs/serverless-runtime-types";
// Fetches specific types
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from "@twilio-labs/serverless-runtime-types/types";

import got from "got";

type MyContext = {
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
  WORKSPACE_SID: string;
  WORKFLOW_SID: string;
  TRAINING_TASK_TYPE: string;
  TRAINING_TASK_URI: string;
};

type MyEvent = {
  event_type: string;
  service_sid: string;
  transcript_sid: string;
  sentences_url: string;
  transcription_url: string;
};

type TranscriptResponse = {
  lup_applied_models: [
    {
      description: string;
      primitive_sid: string;
      // Other stuff we don't need
    }
  ];
  lup_outputs: [
    {
      primitive_sid: string;
      model_sid: string;
      classify_extract_transcript_output: {
        clf_match_prob: number;
        match: boolean;
        // Other stuff we don't need
      };
    }
  ];
  // Other stuff we don't need
};

export const handler: ServerlessFunctionSignature<MyContext, MyEvent> =
  async function (
    context: Context<MyContext>,
    event: MyEvent,
    callback: ServerlessCallback
  ) {
    let response = new Twilio.Response();

    // Ignore events for recordings that aren't completed
    if (event.event_type !== "lit_results_available") {
      console.log(
        `[${event.transcript_sid}] Ignoring event - type: ${event.event_type}`
      );
      return callback(null);
    }

    console.log(">>> INCOMING >>>");
    console.log(event);

    const sleep = (time: number) => {
      return new Promise((resolve) => {
        setTimeout(resolve, time);
      });
    };

    try {
      console.log("Forcing a delay");
      sleep(3000);

      const url = event.transcription_url;
      console.log(`Getting transcript from url: ${url}`);
      const res = await got.get<TranscriptResponse>(url, {
        username: context.ACCOUNT_SID,
        password: context.AUTH_TOKEN,
        responseType: "json",
      });

      // Get the target ID for this mode - using Friendly name below
      let targetModelId = res.body.lup_applied_models.find(
        (e) => e.description === "System Crash"
      )?.primitive_sid;

      // If this model was applied to the transcript
      if (targetModelId) {
        // If the model was found in the transcript there is a match boolean
        let contains_words = res.body.lup_outputs.find(
          (r) => r.primitive_sid === targetModelId
        )?.classify_extract_transcript_output.match;

        response.setBody(`Model ${targetModelId} matched: ${contains_words}`);

        if (contains_words) {
          // Create task
          console.log("Transcript has matches model, creating task");
          let client = context.getTwilioClient();
          let task = await client.taskrouter.v1
            .workspaces(context.WORKSPACE_SID)
            .tasks.create({
              attributes: JSON.stringify({
                type: context.TRAINING_TASK_TYPE,
                training_reason: "System Crash",
                name: "Micro Training",
                transcription_service_sid: event.service_sid,
                transcript_sid: event.transcript_sid,
                transcript_url: event.transcription_url,
                sentences_url: event.sentences_url,
                uri: context.TRAINING_TASK_URI,
              }),
              workflowSid: context.WORKFLOW_SID,
            });

          console.log(`Created task ${task.sid}`);
          response.setBody({ status: "created" });
          return callback(null, { status: "created" });
        }
      } else {
        response.setStatusCode(404);
        response.setBody("Model not found - targetModelId");
      }
      return callback(null, response);
    } catch (e: any) {
      console.error(
        `[${event.service_sid}] Failed to retrieve transcription SID: ` +
          event.transcript_sid
      );
      response.setStatusCode(500);
      console.error(e);
      return callback(null, response);
    }
  };
