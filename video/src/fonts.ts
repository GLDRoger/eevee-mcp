import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

export const fontsReady = Promise.all([
  loadFont({
    family: "Avara",
    url: staticFile("fonts/AvaraVariable.woff2"),
    weight: "300 900",
  }),
  loadFont({
    family: "Carlito",
    url: staticFile("fonts/Carlito-Regular.woff2"),
    weight: "400",
  }),
  loadFont({
    family: "Carlito",
    url: staticFile("fonts/Carlito-Bold.woff2"),
    weight: "700",
  }),
  loadFont({
    family: "Liberation Mono",
    url: staticFile("fonts/LiberationMono-Regular.woff2"),
    weight: "400",
  }),
]);
