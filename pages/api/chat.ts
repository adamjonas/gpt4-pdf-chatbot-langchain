import type { NextApiRequest, NextApiResponse } from 'next';
import { OpenAIEmbeddings } from 'langchain/embeddings/openai';
import { PineconeStore } from 'langchain/vectorstores/pinecone';
import { makeChain } from '@/utils/makechain';
import { initPinecone } from '@/utils/pinecone-client';
import { io } from './socket';
import {
  filterStackexchangeQuestions,
  truncate_chat_history,
} from '@/utils/filter-helper';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { question, history } = req.body;

  //only accept post requests
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!question) {
    return res.status(400).json({ message: 'No question in the request' });
  }
  // OpenAI recommends replacing newlines with spaces for best results
  const sanitizedQuestion = question.trim().replaceAll('\n', ' ');

  try {

    const { pinecone, index, vectorStore } = await initPinecone();

    let k = 4;
    while (1) {
      try {
        //@ts-ignore
        const chain = makeChain(vectorStore, k, res.socket.server.io);
        const response = await chain.call({
          question: sanitizedQuestion,
          chat_history: truncate_chat_history(history, 4000) || [],
          maxTokens: 4097,
        });
        console.log('RESPONSE', response.answer)
        // Get filtered source urls
        const filteredSourceUrls = filterStackexchangeQuestions(
          response.sourceDocuments,
        );
        // Filter out StackExchange questions
        const filteredSourceDocs = response.sourceDocuments.filter((doc: any) =>
          filteredSourceUrls.includes(doc.metadata.url),
        );
        const { sourceDocuments, ...rest } = response;
        const filteredResponse = {
          sourceDocuments: filteredSourceDocs,
          ...rest,
        };

        res.status(200).json(filteredResponse);
        break;
      } catch (e: any) {
        console.log('Error with k: ', k, ' :error: ', e.message);
        if (k == 1) {
          res.status(400).json({ error: e.message || 'Something went wrong' });
          break;
        }
        k--;
      }
    }
  } catch (error: any) {
    console.log('error', error);
    res.status(500).json({ error: error.message || 'Something went wrong' });
  }
}
