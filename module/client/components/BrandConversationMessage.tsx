import type { ReactNode } from "react";
import { FileText, User } from "lucide-react";
import MarkdownRenderer from "@frontmind/module-ui/components/MarkdownRenderer";
import type { LocalMessage } from "../conversation-types";
import MessageActions from "./MessageActions";
import "./brand-conversation-message.css";

/** The original Dashboard message presentation, shared by both Brand hosts. */
export default function BrandConversationMessage({ message, allowCopy = false, children }: {
  message: LocalMessage;
  allowCopy?: boolean;
  children?: ReactNode;
}) {
  const isUser = message.role === "user";
  return (
    <MessageActions message={message} allowCopy={isUser || allowCopy}>
      <div className={`brand-conversation-message brand-conversation-message--${message.role}`}>
        {isUser && <div className="brand-conversation-message__avatar" aria-label="用户"><User aria-hidden="true" size={16} /></div>}
        <div className="brand-conversation-message__content">
          {!!message.attachments?.length && (
            <ul className="brand-conversation-message__attachments" aria-label="消息附件">
              {message.attachments.map(file => <li key={file.id}>{file.base64 || file.blobUrl ? <img src={file.base64 ?? file.blobUrl} alt={file.name} className="brand-conversation-message__attachment-image" /> : <FileText size={16} aria-hidden="true" />}<span>{file.name}</span></li>)}
            </ul>
          )}
          {message.content.trim() && (isUser
            ? <p className="brand-conversation-message__user-text">{message.content}</p>
            : <div className="brand-conversation-message__answer">
                <MarkdownRenderer content={message.content} allowCopy={allowCopy} generalChatLinks />
                {message.inlineImages?.map(image => <img key={image.src} src={image.src} alt={image.alt ?? ""} className="brand-conversation-message__inline-image" />)}
                {message.enterpriseQaAnswer?.sources?.length ? <ul className="brand-conversation-message__sources" aria-label="参考资料">{message.enterpriseQaAnswer.sources.map(source => <li key={source.id}>{source.title}</li>)}</ul> : null}
                {message.outputFiles?.map(file => <a className="brand-conversation-message__output" key={file.fileUrl} href={file.fileUrl} target="_blank" rel="noreferrer">{file.fileName}</a>)}
                {message.stepGroups?.map(group => <details key={group.id} className="brand-conversation-message__steps"><summary>{group.title}</summary>{group.description ? <p>{group.description}</p> : null}<ul>{group.steps.map(step => <li key={step.id}>{step.label}{step.description ? `：${step.description}` : ""}</li>)}</ul></details>)}
                {!message.stepGroups?.length && message.intermediateSteps?.length ? <details className="brand-conversation-message__steps"><summary>执行过程</summary><ul>{message.intermediateSteps.map(step => <li key={step.id}>{step.label}{step.description ? `：${step.description}` : ""}</li>)}</ul></details> : null}
              </div>)}
          {children}
        </div>
      </div>
    </MessageActions>
  );
}
