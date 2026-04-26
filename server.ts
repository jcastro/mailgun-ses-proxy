import dotenv from 'dotenv'
dotenv.config()

import { createServer, IncomingMessage, ServerResponse } from "http"
import next from "next"
import logger from "./lib/core/logger"

import { processNewsletterEventsQueue, processNewsletterQueue, processSystemEventsQueue } from "./service/background-process"

const port = parseInt(process.env.PORT || "3000")
const dev = process.env.NODE_ENV !== "production"

const app = next({ dev })
const handle = app.getRequestHandler()

const handler = (req: IncomingMessage, res: ServerResponse) => {
    const baseURL = `http://${req.headers.host || 'localhost'}`
    const parsedUrl = new URL(req.url!, baseURL)
    handle(req, res, {
        pathname: parsedUrl.pathname,
        query: Object.fromEntries(parsedUrl.searchParams)
    } as any)
}

app.prepare().then(() => {
    createServer(handler).listen(port)
    const type = dev ? "development" : process.env.NODE_ENV
    logger.info(`> Server listening at http://localhost:${port} as ${type}`)

    const startBackgroundWorker = (name: string, queueUrl: string | undefined, worker: () => Promise<void>) => {
        if (!queueUrl) {
            logger.warn({ name }, "Skipping SQS worker because no queue URL is configured")
            return
        }

        worker()
            .catch((e) => { logger.error(e, `${name} queue crashed`) })
            .finally(() => process.exit(1))
    }

    // Process only the queues configured for this deployment.
    startBackgroundWorker("newsletter", process.env.NEWSLETTER_QUEUE, processNewsletterQueue)
    startBackgroundWorker("newsletter events", process.env.NEWSLETTER_NOTIFICATION_QUEUE, processNewsletterEventsQueue)
    startBackgroundWorker("system events", process.env.TRANSACTIONAL_NOTIFICATION_QUEUE, processSystemEventsQueue)

}).catch((e) => { logger.error(e, "stopping the server."); process.exit(1) })
