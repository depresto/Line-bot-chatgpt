import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  middleware,
  SignatureValidationFailed,
  JSONParseError,
  WebhookEvent,
  Client,
} from "@line/bot-sdk";
import { Configuration, OpenAIApi } from "openai";

export default async function (req: VercelRequest, res: VercelResponse) {
  if (
    !process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    !process.env.LINE_CHANNEL_SECRET ||
    !process.env.OPENAI_API_KEY
  ) {
    res
      .status(500)
      .send(
        "LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET or OPENAI_API_KEY is not set"
      );
    return;
  }

  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;

  middleware({
    channelAccessToken,
    channelSecret,
  })(req, res, async (err) => {
    if (err instanceof SignatureValidationFailed) {
      res.status(401).send(err.signature);
      return;
    } else if (err instanceof JSONParseError) {
      res.status(400).send(err.raw);
      return;
    }

    const client = new Client({
      channelAccessToken,
      channelSecret,
    });

    const openAIConfig = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const openAI = new OpenAIApi(openAIConfig);

    const events = req.body.events as WebhookEvent[];
    if (events.length === 0) {
      res.status(200).send("No events");
      return;
    }

    const event = events[0];
    switch (event.type) {
      case "message":
        switch (event.message.type) {
          case "text":
            let replyText = "";
            try {
              const completion = await openAI.createChatCompletion({
                user: event.source.userId,
                model: "gpt-3.5-turbo",
                messages: [
                  {
                    role: "system",
                    content: "以下內容如果是中文的話，請用繁體中文來回答",
                  },
                  {
                    role: "user",
                    content: event.message.text,
                  },
                ],
              });
              replyText = completion.data.choices[0].message?.content ?? "";
            } catch (error) {
              if (error.response) {
                console.log(error.response.status);
                console.log(error.response.data);
              } else {
                console.log(error.message);
              }
            }

            await client.replyMessage(event.replyToken, {
              type: "text",
              text: replyText,
            });
            break;
          default:
            console.log(`Unsupported message type: ${event.message.type}`);
            break;
        }
        break;
      default:
        console.log(`Unsupported event type: ${event.type}`);
        break;
    }

    res.status(200).send({});
  });
}
