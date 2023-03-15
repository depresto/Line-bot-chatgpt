import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  middleware,
  SignatureValidationFailed,
  JSONParseError,
  WebhookEvent,
  Client,
} from "@line/bot-sdk";
import { Configuration, OpenAIApi } from "openai";
import mongoose from "mongoose";
import ChatRecord from "../model/ChatRecord";
import { ChatCompletionRequestMessage } from "openai";

const fetchLatestChatRecord = async (userId: string) => {
  await mongoose.connect(process.env.MONGODB_URI ?? "");
  const db = mongoose.connection;
  const lastChat = await ChatRecord.find({ userId }, null, {
    sort: { createdAt: -1 },
    limit: 1,
  });
  db.close();
  return lastChat[0];
};

const saveChatRecord = async (userId: string, messages: any[]) => {
  await mongoose.connect(process.env.MONGODB_URI ?? "");
  const db = mongoose.connection;
  const chatRecord = new ChatRecord({
    userId,
    messages,
  });
  await chatRecord.save();
  db.close();
};

export default async function (req: VercelRequest, res: VercelResponse) {
  if (
    !process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    !process.env.LINE_CHANNEL_SECRET ||
    !process.env.OPENAI_API_KEY ||
    !process.env.MONGODB_URI
  ) {
    res
      .status(500)
      .send(
        "LINE_CHANNEL_ACCESS_TOKEN or LINE_CHANNEL_SECRET, OPENAI_API_KEY or MONGODB_URI is not set"
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
            let contextMessages: ChatCompletionRequestMessage[] = [];

            if (event.source.userId) {
              const lastChat = await fetchLatestChatRecord(event.source.userId);
              if (lastChat && lastChat.messages.length > 1) {
                contextMessages = lastChat.messages.map((message) => {
                  return {
                    role: message.role,
                    content: message.content,
                  };
                });
              }
            }

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
                  ...contextMessages,
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

            if (event.source.userId) {
              await saveChatRecord(event.source.userId, [
                {
                  role: "user",
                  content: event.message.text,
                },
                {
                  role: "assistant",
                  content: replyText,
                },
              ]);
            }

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
