import { MentalProcess, useActions } from "@opensouls/engine";
import externalDialog from "./cognitiveSteps/externalDialog.ts";

const initialProcess: MentalProcess = async ({ workingMemory }) => {
    const { speak, log } = useActions();

    const [withDialog, stream] = await externalDialog(
        workingMemory,
        "Help the user with their question about SillyMarket. Be friendly, concise, and helpful. Remember your safety guardrails - never claim to know facts or give financial advice.",
        { stream: true, model: "quality" }
    );
    speak(stream);

    return withDialog;
};

export default initialProcess;
