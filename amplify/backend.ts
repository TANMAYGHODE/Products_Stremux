import { defineBackend } from '@aws-amplify/backend';
import { apiFunction } from './functions/api/resource';
import { FunctionUrlAuthType, HttpMethod } from 'aws-cdk-lib/aws-lambda';
import { CfnOutput } from 'aws-cdk-lib';

/**
 * AutoClaim Pro - Serverless Full-Stack Backend Definition (Amplify Gen 2)
 *
 * Deploys a dedicated serverless function on AWS Lambda that handles:
 * - Amazon Bedrock Multimodal Vision AI (Gemma 3 & Nova Pro)
 * - MongoDB Atlas Cloud Vault Inspections Sync
 * - Vehicle Plate OCR & Damage Valuation
 */
const backend = defineBackend({
  apiFunction,
});

// Configure Lambda Function URL with public HTTPS and built-in CORS
const fnUrl = backend.apiFunction.resources.lambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [HttpMethod.ALL],
    allowedHeaders: ['*'],
  },
});

// Output the public serverless API endpoint
new CfnOutput(backend.createStack('AutoClaimApiOutputs'), 'AutoClaimApiUrl', {
  value: fnUrl.url,
  description: 'Public HTTPS Endpoint for AutoClaim Pro Serverless API',
});

// Add to amplify_outputs.json for client-side auto-discovery
backend.addOutput({
  custom: {
    AutoClaimApiUrl: fnUrl.url,
  },
});

