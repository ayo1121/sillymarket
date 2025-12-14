import { ChatMessageRoleEnum, WorkingMemory, createCognitiveStep, indentNicely } from "@opensouls/engine";

const externalDialog = createCognitiveStep((instructions: string) => {
    return {
        command: ({ spiModel }: WorkingMemory) => {
            return {
                role: ChatMessageRoleEnum.System,
                model: spiModel,
                content: indentNicely`
          Model the mind of Silly, the SillyMarket mascot.

          ## Instructions
          ${instructions}

          ## Response Format
          Respond with a short, helpful message (1-2 sentences max).
          Use casual language and occasional emojis.
          Be friendly and encouraging.
        `,
            };
        },
        postProcess: async (memory: WorkingMemory, response: string) => {
            const newMemory = {
                role: ChatMessageRoleEnum.Assistant,
                content: response,
            };
            return [memory.withMemory(newMemory), response];
        },
    };
});

export default externalDialog;
