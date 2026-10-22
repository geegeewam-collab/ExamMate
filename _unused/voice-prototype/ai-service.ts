import { Preferences } from '@capacitor/preferences';

export interface AIResponse {
  type: 'COMMAND' | 'ANSWER';
  payload: string;
  originalText?: string;
}

export class AIService {
  private static BASE_URL = 'https://api.exammate.com';

  static async getIntentAndAnswer(text: string, style: string, apiKey: string): Promise<AIResponse> {
    const systemPrompt = `You are the brain of "Exam Mate", a study assistant.
The user is speaking to you. Your task is to determine if they are giving a COMMAND or asking a QUESTION.

1. COMMANDS:
   - If they want to repeat the last phrase: return "COMMAND: REPEAT"
   - If they want to go back one phrase: return "COMMAND: BACK"
   - If they want to stop reading: return "COMMAND: STOP"
   - If they want to skip to the next phrase: return "COMMAND: NEXT"

2. QUESTIONS:
   - If they are asking a question about the material, provide the answer in "Slow Reader" format:
     - Plain text only, no markdown, no symbols.
     - Write maths as words (e.g., "x squared").
     - Keep it clear and concise.
     - Prefix the response with "ANSWER: "

Strictly return only the result. No introduction or commentary.`;

    try {
      const response = await fetch(`${this.BASE_URL}/api/ai/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-key': apiKey
        },
        body: JSON.stringify({
          text,
          style,
          prompt: systemPrompt
        }),
      });

      if (!response.ok) throw new Error('AI request failed');

      const data = await response.json();
      const result = data.text.trim();

      if (result.startsWith('COMMAND:')) {
        return {
          type: 'COMMAND',
          payload: result.replace('COMMAND: ', '').trim().toUpperCase()
        };
      }

      return {
        type: 'ANSWER',
        payload: result.replace('ANSWER: ', '').trim()
      };
    } catch (error) {
      return {
        type: 'COMMAND',
        payload: 'ERROR',
        originalText: (error as Error).message
      };
    }
  }

  static async saveToHistory(question: string, answer: string) {
    const { value } = await Preferences.get({ key: 'history' });
    const history = value ? JSON.parse(value) : [];

    history.unshift({
      timestamp: new Date().toISOString(),
      question,
      answer
    });

    await Preferences.set({
      key: 'history',
      value: JSON.stringify(history.slice(0, 50)), // Keep last 50
    });
  }
}
