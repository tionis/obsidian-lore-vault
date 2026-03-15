import { ConversationMessage } from './story-chat-document';

export interface StoryChatAssistantFailureParams {
  messages: ConversationMessage[];
  assistantMessageId: string;
  failedVersionId: string;
  previousActiveVersionId: string;
  createdNewMessage: boolean;
  stopRequested: boolean;
  errorMessage: string;
}

export function applyStoryChatAssistantFailure(params: StoryChatAssistantFailureParams): ConversationMessage[] {
  const {
    messages,
    assistantMessageId,
    failedVersionId,
    previousActiveVersionId,
    createdNewMessage,
    stopRequested,
    errorMessage
  } = params;

  return messages.map(message => {
    if (message.id !== assistantMessageId) {
      return {
        ...message,
        versions: message.versions.map(version => ({ ...version }))
      };
    }

    const versions = message.versions.map(version => ({ ...version }));
    const failedVersion = versions.find(version => version.id === failedVersionId);
    if (!failedVersion) {
      return {
        ...message,
        versions
      };
    }

    const contentNow = failedVersion.content.trim();
    if (stopRequested && !contentNow) {
      failedVersion.content = '[Generation stopped.]';
      delete failedVersion.status;
      delete failedVersion.errorMessage;
      return {
        ...message,
        versions
      };
    }

    if (contentNow || createdNewMessage) {
      if (!contentNow) {
        failedVersion.status = 'error';
        failedVersion.errorMessage = errorMessage.trim();
      } else {
        delete failedVersion.status;
        delete failedVersion.errorMessage;
      }
      return {
        ...message,
        versions
      };
    }

    const remainingVersions = versions.filter(version => version.id !== failedVersionId);
    if (remainingVersions.length === 0) {
      failedVersion.status = 'error';
      failedVersion.errorMessage = errorMessage.trim();
      return {
        ...message,
        versions: [failedVersion],
        activeVersionId: failedVersion.id
      };
    }

    return {
      ...message,
      versions: remainingVersions,
      activeVersionId: remainingVersions.some(version => version.id === previousActiveVersionId)
        ? previousActiveVersionId
        : remainingVersions[0].id
    };
  });
}
