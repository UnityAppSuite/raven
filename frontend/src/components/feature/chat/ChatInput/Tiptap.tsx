import { BubbleMenu, Editor, EditorContent, EditorContext, Extension, ReactRenderer, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import React, { Suspense, forwardRef, lazy, useContext, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { TextFormattingMenu } from './TextFormattingMenu'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import './tiptap.styles.css'
import Mention from '@tiptap/extension-mention'
import { UserFields, UserListContext } from '@/utils/users/UserListProvider'
import MentionList from './MentionList'
import tippy from 'tippy.js'
import { PluginKey } from '@tiptap/pm/state'
import { ChannelListContext, ChannelListContextType, ChannelListItem } from '@/utils/channel/ChannelListProvider'
import ChannelMentionList from './ChannelMentionList'
import { ToolPanel } from './ToolPanel'
import { RightToolbarButtons, SendButton } from './RightToolbarButtons'
import { common, createLowlight } from 'lowlight'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import css from 'highlight.js/lib/languages/css'
import js from 'highlight.js/lib/languages/javascript'
import ts from 'highlight.js/lib/languages/typescript'
import html from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import { Plugin } from 'prosemirror-state'
import { Box, Flex, IconButton } from '@radix-ui/themes'
import { useStickyState } from '@/hooks/useStickyState'
import { Message } from '../../../../../../types/Messaging/Message'
import Image from '@tiptap/extension-image'
import { EmojiSuggestion } from './EmojiSuggestion'
import { useIsDesktop, useIsMobile } from '@/hooks/useMediaQuery'
import { BiPlus } from 'react-icons/bi'
import clsx from 'clsx'
import { ChannelMembers } from '@/hooks/fetchers/useFetchChannelMembers'
import TimestampRenderer from '../ChatMessage/Renderers/TiptapRenderer/TimestampRenderer'
import { useParams } from 'react-router-dom'
import { useAtom } from 'jotai'
import { EnterKeyBehaviourAtom } from '@/utils/preferences'
const MobileInputActions = lazy(() => import('./MobileActions/MobileInputActions'))

const lowlight = createLowlight(common)

lowlight.register('html', html)
lowlight.register('css', css)
lowlight.register('js', js)
lowlight.register('ts', ts)
lowlight.register('json', json)
lowlight.register('python', python)
export interface ToolbarFileProps {
    fileInputRef: React.MutableRefObject<any>,
    addFile: (files: File) => void,
}
type TiptapEditorProps = {
    isEdit?: boolean,
    slotBefore?: React.ReactNode,
    slotAfter?: React.ReactNode,
    placeholder?: string,
    sessionStorageKey?: string,
    clearReplyMessage?: () => void,
    disableSessionStorage?: boolean,
    fileProps?: ToolbarFileProps,
    onMessageSend: (message: string, json: any, sendSilently?: boolean) => Promise<void>,
    messageSending: boolean,
    defaultText?: string,
    replyMessage?: Message | null,
    channelMembers?: ChannelMembers,
    channelID?: string,
    onUserType?: () => void,
    onUpArrow?: () => void,
}

export const UserMention = Mention.extend({
    name: 'userMention',
})
    .configure({
        suggestion: {
            char: '@',
            pluginKey: new PluginKey('userMention'),
            // Allow any character to be a prefix for a user mention
            allowedPrefixes: null,
            allow: (props) => {
                // Do not allow mentions if the preceding character is a letter or digit
                const precedingCharacter = props.state.doc.textBetween(props.range.from - 1, props.range.from, '')
                return !/[a-zA-Z0-9]/.test(precedingCharacter)
            }
        }
    })

export const ChannelMention = Mention.extend({
    name: 'channelMention',
    addAttributes() {
        return {
            ...this.parent?.(),
            /**
             * The character this mention was typed with. A channel can be mentioned from
             * '#' (link to the channel) or from '@' (notify everyone in it), and we render
             * back whichever the user actually typed instead of always showing '#'.
             */
            char: {
                default: '#',
                parseHTML: (element: HTMLElement) => element.getAttribute('data-mention-char') || '#',
                renderHTML: (attributes: Record<string, any>) => ({ 'data-mention-char': attributes.char ?? '#' }),
            },
        }
    },
})
    .configure({
        suggestion: {
            char: '#',
            pluginKey: new PluginKey('channelMention'),
            // Allow any character to be a prefix for a channel mention
            allowedPrefixes: null,
            allow: (props) => {
                // Do not allow mentions if the preceding character is a letter or digit
                const precedingCharacter = props.state.doc.textBetween(props.range.from - 1, props.range.from, '')
                return !/[a-zA-Z0-9]/.test(precedingCharacter)
            }
        }
    })

export interface MemberSuggestions extends UserFields {
    mention_type: 'user'
}

export interface ChannelSuggestion extends ChannelListItem {
    mention_type: 'channel'
}

/** '@' offers both the people in this channel and the channels you can mention */
export type MentionSuggestion = MemberSuggestions | ChannelSuggestion

const Tiptap = forwardRef(({ isEdit, slotBefore, fileProps, onMessageSend, onUpArrow, channelMembers, onUserType, channelID, replyMessage, clearReplyMessage, placeholder = 'Type a message...', messageSending, sessionStorageKey = 'tiptap-editor', disableSessionStorage = false, defaultText = '' }: TiptapEditorProps, ref) => {

    const { enabledUsers } = useContext(UserListContext)

    const channelMembersRef = useRef<MemberSuggestions[]>([])

    useEffect(() => {
        // Only people who are actually in this channel can be mentioned here - mentioning
        // someone who cannot read the channel just sends a notification they can't act on.
        // While the member list is still loading we fall back to every enabled user so the
        // '@' menu is never empty.
        const memberIDs = channelMembers ? Object.keys(channelMembers) : []

        const users = memberIDs.length
            ? enabledUsers.filter((user) => user.name in channelMembers!)
            : enabledUsers

        channelMembersRef.current = users.map((user) => ({
            ...user,
            mention_type: 'user' as const
        }))
    }, [channelMembers, enabledUsers])

    const { channels } = useContext(ChannelListContext) as ChannelListContextType

    const { workspaceID } = useParams()

    /** Channels that can be mentioned - excludes archived channels and other workspaces */
    const mentionableChannelsRef = useRef<ChannelSuggestion[]>([])

    useEffect(() => {
        mentionableChannelsRef.current = channels
            .filter((channel) => !channel.is_archived && channel.workspace === workspaceID)
            .map((channel) => ({ ...channel, mention_type: 'channel' as const }))
    }, [channels, workspaceID])

    const isMobile = useIsMobile()

    const [enterKeyBehaviour] = useAtom(EnterKeyBehaviourAtom)

    const handleMessageSendAction = (editor: any) => {

        const hasContent = editor.getText().trim().length > 0
        let html = ''
        let json = {}
        if (hasContent) {
            html = editor.getHTML()
            json = editor.getJSON()
        }

        editor.setEditable(false)

        onMessageSend(html, json)
            .then(() => {
                editor.commands.clearContent(true);
                editor.setEditable(true)
                editor.commands.focus('start')
            })
            .catch(() => {
                editor.setEditable(true)
            })
        return editor.commands.clearContent(true);
    }

    const handleNewLineAction = (editor: any) => {
        return editor.commands.first(({ commands }: { commands: any }) => [
            () => commands.newlineInCode(),
            () => commands.createParagraphNear(),
            () => commands.liftEmptyBlock(),
            () => commands.splitBlock(),
        ]);
    }
    // this is a dummy extension only to create custom keydown behavior
    const KeyboardHandler = Extension.create({
        name: 'keyboardHandler',
        addKeyboardShortcuts() {
            return {
                Enter: () => {
                    //  Check for phone
                    if (matchMedia('(max-device-width: 768px)').matches) {
                        return false
                    }

                    // Check for iPad
                    if (matchMedia('(max-device-width: 1024px)').matches) {
                        return false
                    }

                    const isCodeBlockActive = this.editor.isActive('codeBlock');
                    const isListItemActive = this.editor.isActive('listItem');



                    if (isCodeBlockActive || isListItemActive) {
                        return false;
                    }

                    if (enterKeyBehaviour === 'send-message') {
                        return handleMessageSendAction(this.editor)
                    } else {
                        return handleNewLineAction(this.editor)
                    }

                },

                'Mod-Enter': () => {
                    const isCodeBlockActive = this.editor.isActive('codeBlock');
                    const isListItemActive = this.editor.isActive('listItem');
                    const hasContent = this.editor.getText().trim().length > 0
                    /**
                     * when inside of a codeblock and setting for sending the message with CMD/CTRL-Enter
                     * force calling the `onSubmit` function and clear the editor content
                     */
                    if (isCodeBlockActive) {
                        return this.editor.commands.newlineInCode();
                    }

                    if (isListItemActive) {
                        return false
                    }

                    if (!isCodeBlockActive && !isListItemActive) {
                        let html = ''
                        let json = {}
                        if (hasContent) {
                            html = this.editor.getHTML()
                            json = this.editor.getJSON()
                        }

                        this.editor.setEditable(false)
                        onMessageSend(html, json)
                            .then(() => {
                                this.editor.commands.clearContent(true);
                                this.editor.setEditable(true)
                            })
                            .catch(() => {
                                this.editor.setEditable(true)
                            })
                        return this.editor.commands.clearContent(true);
                    }

                    return false;
                },
                Backspace: () => {
                    const isEditorEmpty = this.editor.isEmpty

                    if (isEditorEmpty) {
                        // Clear the reply message if the editor is empty
                        clearReplyMessage?.()
                        return this.editor.commands.clearContent(true)
                    }

                    return false
                },
                'Shift-Enter': () => {
                    return handleNewLineAction(this.editor)
                },
                'ArrowUp': () => {
                    // If the editor is empty, call the onUpArrow function
                    if (this.editor.isEmpty) {
                        onUpArrow?.()
                    }
                    return false
                }
            };
        },
        addProseMirrorPlugins() {
            return [
                new Plugin({
                    props: {
                        handleDOMEvents: {
                            drop(view, event) {
                                const hasFiles =
                                    event.dataTransfer &&
                                    event.dataTransfer.files &&
                                    event.dataTransfer.files.length

                                if (!hasFiles || !fileProps) {
                                    return
                                }

                                const images = Array.from(event.dataTransfer.files).filter(file =>
                                    /image/i.test(file.type)
                                )

                                if (images.length === 0) {
                                    return
                                }

                                event.preventDefault()

                                images.forEach(image => {
                                    fileProps.addFile(image)
                                })
                            },
                            paste(view, event) {
                                const hasFiles =
                                    event.clipboardData &&
                                    event.clipboardData.files &&
                                    event.clipboardData.files.length

                                if (!hasFiles || !fileProps) {
                                    return
                                }

                                const files = Array.from(
                                    event.clipboardData.files
                                )
                                if (files.length === 0) {
                                    return
                                }

                                event.preventDefault()

                                files.forEach(file => {
                                    fileProps.addFile(file)
                                })
                            }
                        }
                    }
                })
            ]
        }
    });
    const extensions = [
        StarterKit.configure({
            heading: false,
            codeBlock: false,
            listItem: {
                HTMLAttributes: {
                    class: 'rt-Text text-sm'
                }
            },
            paragraph: {
                HTMLAttributes: {
                    class: 'rt-Text text-sm'
                }
            },
            code: {
                HTMLAttributes: {
                    class: 'pt-0.5 px-1 pb-px bg-[var(--gray-a3)] dark:bg-[#0d0d0d] text-[var(--ruby-a11)] dark-[var(--accent-a3)] text text-xs font-mono rounded border border-gray-4 dark:border-gray-6'
                }
            },
        }),
        Underline,
        Highlight.configure({
            multicolor: true,
            HTMLAttributes: {
                class: 'bg-[var(--yellow-6)] dark:bg-[var(--yellow-11)] px-2 py-1'
            }
        }),
        Link.extend({ inclusive: false }).configure({
            autolink: true,
        }),
        Placeholder.configure({
            // Pick a random placeholder from the list.
            placeholder,
        }),
        CodeBlockLowlight.extend({
            addKeyboardShortcuts() {
                return {
                    // this extends existing shortcuts instead of overwriting
                    ...this.parent?.(),
                    'Mod-Shift-E': () => this.editor.commands.toggleCodeBlock(),
                }
            }
        }).configure({
            lowlight
        }),
        Image.configure({
            inline: true,
        }),
        KeyboardHandler,
        UserMention.configure({
            HTMLAttributes: {
                class: 'mention',
            },
            renderHTML({ options, node }) {
                return `${options.suggestion.char}${node.attrs.label ?? node.attrs.id}`
            },
            suggestion: {
                items: ({ query }) => {
                    const search = query.toLowerCase()

                    // People first, then channels - typing '@' offers both, and picking a
                    // channel notifies everyone in it.
                    const users = channelMembersRef.current
                        .filter((user) => user.full_name.toLowerCase().startsWith(search))
                        .slice(0, 10)

                    const mentionedChannels = mentionableChannelsRef.current
                        .filter((channel) => channel.channel_name.toLowerCase().startsWith(search))
                        .slice(0, 5)

                    return [...users, ...mentionedChannels] as MentionSuggestion[]
                },
                // char: '@',
                command: ({ editor, range, props }) => {
                    // A channel picked from the '@' menu has to be inserted as a
                    // channelMention node - that is what the server reads to resolve the
                    // channel to its members.
                    const { id, label, mention_type } = props as unknown as { id: string, label: string, mention_type?: 'user' | 'channel' }

                    const isChannel = mention_type === 'channel'

                    const attrs = isChannel
                        ? { id, label, char: '@' }
                        : { id, label }

                    // Don't leave a double space behind if one already follows the mention
                    const nodeAfter = editor.view.state.selection.$to.nodeAfter
                    if (nodeAfter?.text?.startsWith(' ')) {
                        range.to += 1
                    }

                    editor.chain().focus().insertContentAt(range, [
                        { type: isChannel ? 'channelMention' : 'userMention', attrs },
                        { type: 'text', text: ' ' },
                    ]).run()

                    window.getSelection()?.collapseToEnd()
                },
                render: () => {
                    let component: any;
                    let popup: any;

                    return {
                        onStart: props => {
                            component = new ReactRenderer(MentionList, {
                                props,
                                editor: props.editor,
                            })

                            if (!props.clientRect) {
                                return
                            }

                            popup = tippy('body' as any, {
                                getReferenceClientRect: props.clientRect as any,
                                appendTo: () => document.body,
                                content: component.element,
                                showOnCreate: true,
                                interactive: true,
                                trigger: 'manual',
                                placement: 'bottom-start',
                            })
                        },

                        onUpdate(props) {
                            component.updateProps(props)

                            if (!props.clientRect) {
                                return
                            }

                            popup[0].setProps({
                                getReferenceClientRect: props.clientRect,
                            })
                        },

                        onKeyDown(props) {
                            if (props.event.key === 'Escape') {
                                popup[0].hide()

                                return true
                            }

                            return component.ref?.onKeyDown(props)
                        },

                        onExit() {
                            popup[0].destroy()
                            component.destroy()
                        },
                    }
                },

            }
        }),
        ChannelMention.configure({
            HTMLAttributes: {
                class: 'mention',
            },
            renderHTML({ options, node }) {
                return `${node.attrs.char ?? options.suggestion.char}${node.attrs.label ?? node.attrs.id}`
            },
            suggestion: {
                items: ({ query }) => {
                    return mentionableChannelsRef.current
                        .filter((channel) => channel.channel_name.toLowerCase().startsWith(query.toLowerCase()))
                        .slice(0, 10)
                },
                // char: '#',
                render: () => {
                    let component: any;
                    let popup: any;

                    return {
                        onStart: props => {
                            component = new ReactRenderer(ChannelMentionList, {
                                props,
                                editor: props.editor,
                            })

                            if (!props.clientRect) {
                                return
                            }

                            popup = tippy('body' as any, {
                                getReferenceClientRect: props.clientRect as any,
                                appendTo: () => document.body,
                                content: component.element,
                                showOnCreate: true,
                                interactive: true,
                                trigger: 'manual',
                                placement: 'bottom-start',
                            })
                        },

                        onUpdate(props) {
                            component.updateProps(props)

                            if (!props.clientRect) {
                                return
                            }

                            popup[0].setProps({
                                getReferenceClientRect: props.clientRect,
                            })
                        },

                        onKeyDown(props) {
                            if (props.event.key === 'Escape') {
                                popup[0].hide()

                                return true
                            }

                            return component.ref?.onKeyDown(props)
                        },

                        onExit() {
                            popup[0].destroy()
                            component.destroy()
                        },
                    }
                },

            }
        }),
        TimestampRenderer
    ]

    const [content, setContent] = useStickyState(defaultText, sessionStorageKey, disableSessionStorage)

    const isDesktop = useIsDesktop()

    const editor = useEditor({
        extensions: isDesktop ? extensions.concat([EmojiSuggestion]) : extensions,
        content,
        editorProps: {
            handleTextInput() {
                onUserType?.()
            },
            attributes: {
                class: 'tiptap-editor' + (replyMessage ? ' replying' : '') + (isEdit ? ' editing-message' : '')
            }
        },
        onUpdate({ editor }) {
            setContent(editor.getHTML())
        }
    }, [replyMessage, onUserType])



    useEffect(() => {
        if (isDesktop || isEdit) {
            setTimeout(() => {
                editor?.chain().focus('end').run()
            }, 50)
        }
    }, [editor, isDesktop, isEdit, replyMessage])

    useImperativeHandle(ref, () => ({
        focusEditor: () => {
            editor?.chain().focus().run()
        }
    }))


    if (isMobile) {
        return <Box className={clsx('pt-2 pb-8 w-full bg-white dark:bg-gray-2 z-50 border-t border-t-gray-3 dark:border-t-gray-3',
            isEdit ? 'bg-transparent dark:bg-transparent' : 'fixed bottom-0 left-0 px-4'
        )}>
            <EditorContext.Provider value={{ editor }}>
                {slotBefore}
                <Flex align='end' gap='2' className='w-full'>
                    {!isEdit &&
                        <div className='w-8'>
                            <Suspense fallback={<IconButton radius='full' color='gray' variant='soft' size='2' className='mb-1'>
                                <BiPlus size='20' />
                            </IconButton>}>
                                <MobileInputActions fileProps={fileProps} setContent={setContent} sendMessage={onMessageSend} messageSending={messageSending} channelID={channelID} />
                            </Suspense>
                        </div>
                    }
                    <BubbleMenu tippyOptions={{
                        arrow: true,
                        // followCursor: true,
                        offset: [90, 15],
                        inlinePositioning: true,
                    }}
                        editor={editor}>
                        <div className='bg-gray-1 dark:bg-gray-3 shadow-md p-2 rounded-md'>
                            <TextFormattingMenu />
                        </div>
                    </BubbleMenu>
                    <div className='border-[1.5px] flex items-end justify-between border-gray-4 rounded-radius2 w-[calc(100vw-72px)] focus-within:border-accent-a8'>
                        <div className='w-[85%]'>
                            <EditorContent editor={editor} />
                        </div>
                        <div className='flex items-center justify-center h-full'>
                            <SendButton
                                size='2'
                                variant='soft'
                                // The send options live in the "+" menu on mobile, so the
                                // chevron beside the send button is redundant here.
                                showOptions={false}
                                boxProps={{
                                    className: 'rounded-r-radius2 rounded-l-none bg-transparent',
                                    gap: '0'
                                }}
                                className='bg-transparent hover:bg-accent-a3'
                                sendMessage={onMessageSend}
                                messageSending={messageSending}
                                setContent={setContent} />
                        </div>
                    </div>
                </Flex>
            </EditorContext.Provider>
        </Box>
    }

    return (
        <Box className='border rounded-radius2 border-gray-300 dark:border-gray-500 dark:bg-gray-3'>
            <EditorContext.Provider value={{ editor }}>
                {slotBefore}
                <EditorContent editor={editor} />
                <ToolPanel>
                    <TextFormattingMenu />
                    <RightToolbarButtons fileProps={fileProps} setContent={setContent} sendMessage={onMessageSend} messageSending={messageSending}
                        isEdit={isEdit}
                        channelID={channelID} />
                </ToolPanel>
            </EditorContext.Provider>
        </Box>

    )



})

export default Tiptap