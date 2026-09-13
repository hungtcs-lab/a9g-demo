import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core'
import '@mantine/core/styles.css'
import '@mantine/dropzone/styles.css'
import './index.css'
import App from './App.tsx'

const theme = createTheme({
  primaryColor: 'ochre',
  primaryShade: { light: 6, dark: 4 },
  defaultRadius: 'md',
  fontFamily: "system-ui, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  colors: {
    ochre: [
      '#fff8e6', '#ffedc4', '#ffdc94', '#ffca61', '#ffba38',
      '#f0a202', '#d18b00', '#a56c00', '#7a4f00', '#4e3200',
    ],
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <App />
    </MantineProvider>
  </StrictMode>,
)
