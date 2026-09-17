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
              {message.attachments.map(file => <li key={file.id}><FileText size={16} aria-hidden="true" /><span>{file.name}</span></li>)}
            </ul>
          )}
          {message.content.trim() && (isUser
            ? <p className="brand-conversation-message__user-text">{message.content}</p>
            : <div className="brand-conversation-message__answer"><MarkdownRenderer content={message.content} allowCopy={allowCopy} /></div>)}
          {children}
        </div>
      </div>
    </MessageActions>
  );
}
