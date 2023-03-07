import mongoose from "mongoose";

const ChatRecordSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  messages: [
    {
      role: {
        type: String,
        enum: ["user", "system", "assistant"],
        required: true,
      },
      content: {
        type: String,
        required: true,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("ChatRecord", ChatRecordSchema);
