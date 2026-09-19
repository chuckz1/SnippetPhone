# Overview

The purpose of this project is to make a phone call app that handles poor network conditions efficiently.
I use voice activity detection (VAD) to extract just the snippets of someone talking. It then will send them over the network, reducing the amount of data transmitted and improving call quality under poor network conditions.
It will add an id to every snippet of audio before sending it over the network. The receiver will use these ids to reconstruct the audio in the correct order, ensuring smooth playback even if some snippets arrive out of order.
The app will auto detect when connection is good and will send live voice when possible, switching back to snippet-based transmission when the network is poor. In extreme cases of poor network conditions, it may switch to a completely text-based communication mode, using text to speech to reconstruct the text as audible speech.

## Implementation Plan

- Implement voice activity detection (VAD) to extract snippets of speech.
- Assign unique IDs to each audio snippet before sending.
- Develop a mechanism to reconstruct audio from received snippets using their IDs.
- Implement network quality detection to switch between live voice and snippet-based transmission.
- Optimize data transmission to handle poor network conditions efficiently.
- Use ricky0123/vad for voice activity detection.

## example for including the vad

```javascript
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/bundle.min.js"></script>

<script>
  async function main() {
    const myvad = await vad.MicVAD.new({
      onSpeechStart: () => console.log("Speech start"),
      onSpeechEnd: (audio) => console.log("Speech end", audio),
      onnxWASMBasePath:
        "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/",
      baseAssetPath:
        "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/",
    });

    myvad.start();
  }

  main();
</script>
```
