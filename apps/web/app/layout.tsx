import "./globals.css";
import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "@mantine/dates/styles.css";
import { ColorSchemeScript, MantineProvider } from "@mantine/core";
import { MonitorShell } from "@/components/monitor-shell";

export const metadata = {
  title: "Stock Agent",
  description: "Stock Agent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <MantineProvider defaultColorScheme="light">
          <MonitorShell>{children}</MonitorShell>
        </MantineProvider>
      </body>
    </html>
  );
}
