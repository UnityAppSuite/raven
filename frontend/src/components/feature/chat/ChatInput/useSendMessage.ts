import { useFrappePostCall, useSWRConfig } from 'frappe-react-sdk'
import { Message } from '../../../../../../types/Messaging/Message'
import { RavenMessage } from '@/types/RavenMessaging/RavenMessage'
import { useCallback } from 'react'
import { filesAtom } from './FileInput/useFileUpload'
import { useAtomCallback } from 'jotai/utils'
import { useUserData } from '@/hooks/useUserData'

/** Frappe stores datetimes as "YYYY-MM-DD HH:mm:ss.SSSSSS" in system time. */
const nowAsFrappeDatetime = () => {
    const d = new Date()
    const p = (n: number, l = 2) => String(n).padStart(l, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}000`
}

export const useSendMessage = (channelID: string, uploadFiles: (selectedMessage?: Message | null, caption?: string) => Promise<RavenMessage[]>, onMessageSent: (messages: RavenMessage[]) => void, selectedMessage?: Message | null) => {

    const { call, loading } = useFrappePostCall<{ message: RavenMessage }>('raven.api.raven_message.send_message')

    const { name: currentUser } = useUserData()

    const { mutate } = useSWRConfig()

    // const files = useAtomValue(filesAtom(channelID))

    const getFiles = useAtomCallback(useCallback((get) => {
        return get(filesAtom(channelID))
    }, [channelID]))

    /**
     * Optimistic update.
     *
     * Without this the composer awaits the full round-trip to the server before
     * anything is painted, so the message is invisible for the whole network
     * latency. We insert a placeholder immediately and drop it again once the
     * real message arrives (or the send fails), letting the server response and
     * the "message_created" socket event stay the single source of truth.
     *
     * The cache key mirrors the one useChatStream passes to useFrappeGetCall,
     * and the same shape ChatBoxBody's onMessageSendCompleted writes.
     */
    const cacheKey = { path: `get_messages_for_channel_${channelID}` }

    const insertOptimisticMessage = useCallback((tempName: string, content: string) => {
        const optimistic = {
            name: tempName,
            owner: currentUser,
            creation: nowAsFrappeDatetime(),
            modified: nowAsFrappeDatetime(),
            modified_by: currentUser,
            channel_id: channelID,
            text: content,
            content: content,
            message_type: 'Text',
            is_edited: 0,
            is_reply: selectedMessage ? 1 : 0,
            linked_message: selectedMessage ? selectedMessage.name : null,
            is_thread: 0,
            is_forwarded: 0,
            is_bot_message: 0,
            _liked_by: '',
            is_pinned: 0,
            is_continuation: 0,
            // Lets the UI tell "still sending" apart from a delivered message.
            is_optimistic: 1,
        }

        mutate(cacheKey, (d: any) => {
            // Only safe to append when the cache holds the newest page —
            // otherwise the message belongs to a page we have not loaded.
            if (!d || d.message.has_new_messages !== false) return d

            return {
                message: {
                    messages: [optimistic, ...(d.message.messages ?? [])].sort((a: any, b: any) =>
                        new Date(b.creation).getTime() - new Date(a.creation).getTime()
                    ),
                    has_old_messages: d.message.has_old_messages ?? false,
                    has_new_messages: d.message.has_new_messages ?? false,
                }
            }
        }, { revalidate: false })
    }, [channelID, currentUser, selectedMessage, mutate])

    const removeOptimisticMessage = useCallback((tempName: string) => {
        mutate(cacheKey, (d: any) => {
            if (!d) return d
            return {
                message: {
                    ...d.message,
                    messages: (d.message.messages ?? []).filter((m: any) => m.name !== tempName),
                }
            }
        }, { revalidate: false })
    }, [channelID, mutate])

    const sendMessage = useCallback(async (content: string, json?: any, sendSilently: boolean = false): Promise<void> => {

        const files = getFiles()

        const hasFiles = files.length > 0

        // If we have both content and files, upload files with the content as caption
        if (content && hasFiles) {
            return uploadFiles(selectedMessage, content)
                .then((res) => {
                    onMessageSent(res)
                })
        }
        // If we only have content, send a regular text message
        else if (content) {
            const tempName = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            insertOptimisticMessage(tempName, content)

            return call({
                channel_id: channelID,
                text: content,
                json_content: json,
                is_reply: selectedMessage ? 1 : 0,
                linked_message: selectedMessage ? selectedMessage.name : null,
                send_silently: sendSilently ? true : false
            })
                .then((res) => {
                    removeOptimisticMessage(tempName)
                    onMessageSent([res.message])
                })
                .catch((err) => {
                    // Drop the placeholder so a failed send does not look delivered.
                    removeOptimisticMessage(tempName)
                    throw err
                })
        }
        // If we only have files, upload them without caption
        else if (hasFiles) {
            return uploadFiles(selectedMessage)
                .then((res) => {
                    onMessageSent(res)
                })
        }
        // No content and no files - do nothing
        else {
            return Promise.resolve()
        }
    }, [channelID, selectedMessage, uploadFiles, onMessageSent, insertOptimisticMessage, removeOptimisticMessage])


    return {
        sendMessage,
        loading
    }
}
