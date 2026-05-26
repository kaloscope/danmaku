# Cloud Functions on EdgeOne Pages - Koa Demo Website

A demonstration website for function requests developed with Next.js + Tailwind CSS + shadcn/ui technology stack, showcasing how to deploy and run Cloud Functions based on the Koa framework on EdgeOne Pages.

## 🚀 Features

- **Modern UI Design**：Adopting a black background with white text theme, using #1c66e5 as the accent color
- **Responsive Layout**：Supporting desktop and mobile devices, providing the best user experience
- **Real-time API Demo**：Integrating Express backend, supporting real-time function call testing
- **Componentized Architecture**：Using shadcn/ui style component system
- **TypeScript Support**：Complete type definitions and type safety

## 🛠️ Technology Stack

### Frontend
- **Next.js 15** - React full-stack framework
- **React 19** - User interface library
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS 4** - Utility-first CSS framework

### UI Components
- **shadcn/ui** - High-quality React components
- **Lucide React** - Beautiful icon library
- **class-variance-authority** - Component style variant management
- **clsx & tailwind-merge** - CSS class name merging tool

### Backend
- **Express.js** - Node.js Web application framework
- **Cloud Functions** - EdgeOne Pages serverless function

## 📁 Project Structure

```
express-template/
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── globals.css     # Global styles
│   │   ├── layout.tsx      # Root layout
│   │   └── page.tsx        # Main page
│   ├── components/         # React components
│   │   └── ui/            # UI basic components
│   │       ├── button.tsx  # Button component
│   │       └── card.tsx    # Card component
│   └── lib/               # Utility functions
│       └── utils.ts       # General utilities
├── public/                # Static resources
├── package.json           # Project configuration
└── README.md             # Project documentation
```

## 🚀 Quick Start

### Environment Requirements

- Node.js 18+ 
- npm or yarn

### Install Dependencies

```bash
npm install
# or
yarn install
```

### Development Mode

```bash
edgeone pages dev
```

Access [http://localhost:8088](http://localhost:8088) to view the application.

### Build Production Version

```bash
edgeone pages build
```

## 🎯 Core Features

### 1. Main Page Display
- Project title and description
- One-click deployment and documentation view button
- Express code example display

### 2. API Call Demo
- Real-time function call testing
- Loading status display
- Result display

### 3. Responsive Design
- Mobile-friendly layout
- Adaptive component sizing
- Touch-friendly interaction

## 🔧 Configuration Explanation

### Tailwind CSS Configuration
The project uses Tailwind CSS 4, supporting custom color variables:

```css
:root {
  --primary: #1c66e5;        /* Primary color */
  --background: #000000;     /* Background color */
  --foreground: #ffffff;     /* Foreground color */
}
```

### Component Style
Using `class-variance-authority` to manage component style variants, supporting multiple preset styles.

## 📚 Documentation Entry

- **EdgeOne Pages Official Documentation**：[https://docs.edgeone.com](https://docs.edgeone.com)
- **Next.js Documentation**：[https://nextjs.org/docs](https://nextjs.org/docs)
- **Tailwind CSS Documentation**：[https://tailwindcss.com/docs](https://tailwindcss.com/docs)
- **Express.js Documentation**：[https://expressjs.com](https://expressjs.com)

## 🚀 Deployment Guide

### EdgeOne Pages Deployment

1. Push the code to a GitHub repository
2. Create a new project in the EdgeOne Pages console
3. Select the GitHub repository as the source
4. Configure the build command: `npm run build`
5. Configure the output directory: `.next`
6. Deploy the project

### Cloud Functions Configuration

Create a `cloud-functions/` folder in the project root directory, adding an Express application:

```javascript
// cloud-functions/express/[[default]].js
import express from "express";
const app = express();

app.get("/", (req, res) => {
  res.json({ message: "Hello from Express on Cloud Functions!" });
});

export default app;
```


## Deployment

[![Deploy with EdgeOne Pages](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?from=github&template=koa-template)


## 📄 License

This project uses the MIT License - see the [LICENSE](https://github.com/github/choosealicense.com/blob/gh-pages/_licenses/mit.txt) file for details.
