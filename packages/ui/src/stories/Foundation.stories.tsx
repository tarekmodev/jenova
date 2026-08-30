/**
 * Foundation showcase: palette, type scale, elevation — the Jenova
 * visual language in one screen (both directions via the toolbar).
 */

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { jenovaPalettes } from "../theme/tokens";
import { pickCopy } from "./support";

const meta: Meta = {
  title: "Foundation/Theme",
};
export default meta;

const CHANNELS = ["primary", "secondary", "success", "info", "warning", "error"] as const;

export const Tokens: StoryObj = {
  render: (_args, context) => {
    const copy = pickCopy(context.globals, {
      ar: { palette: "الألوان", type: "الخط", sample: "منصة جينوفا للسفر" },
      en: { palette: "Palette", type: "Typography", sample: "Jenova travel platform" },
    });
    return (
      <Stack spacing={3}>
        <Card>
          <CardContent>
            <Typography variant="h5" sx={{ marginBlockEnd: 2 }}>
              {copy.palette}
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {CHANNELS.map((channel) => (
                <Box
                  key={channel}
                  sx={{
                    width: 120,
                    borderRadius: 1,
                    overflow: "hidden",
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  <Box
                    sx={{
                      backgroundColor: jenovaPalettes.light[channel].main,
                      color: jenovaPalettes.light[channel].contrastText,
                      padding: 1.5,
                    }}
                  >
                    <Typography variant="body2">{channel}</Typography>
                  </Box>
                  <Box sx={{ backgroundColor: jenovaPalettes.light[channel].light, padding: 1 }}>
                    <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {jenovaPalettes.light[channel].main}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Stack>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="h5" sx={{ marginBlockEnd: 2 }}>
              {copy.type}
            </Typography>
            <Stack spacing={1}>
              {(["h1", "h2", "h3", "h4", "h5", "h6", "body1", "body2"] as const).map((variant) => (
                <Typography key={variant} variant={variant}>
                  {variant} — {copy.sample}
                </Typography>
              ))}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    );
  },
};
