import { DropdownMenu, Flex, IconButton } from '@radix-ui/themes'
import { BiPlus } from 'react-icons/bi'
import { RightToolbarButtonsProps, useSendFromEditor } from '../RightToolbarButtons'
import { MdOutlineBarChart } from 'react-icons/md'
import { HiOutlineGif } from 'react-icons/hi2'
import { BiBellOff } from 'react-icons/bi'
import AttachFile from './AttachFile'
import { useBoolean } from '@/hooks/useBoolean'
import CreatePollDrawer from './CreatePollDrawer'
import AddGIFDrawer from './AddGIFDrawer'

const MobileInputActions = ({ fileProps, channelID, sendMessage, setContent }: RightToolbarButtonsProps) => {

    const [isPollOpen, { on: onPollOpen }, setIsPollOpen] = useBoolean()
    const [isGIFPickerOpen, { on: onGIFPickerOpen }, setIsGIFPickerOpen] = useBoolean()

    // Same code path as the desktop send-options chevron: sendSilently=true makes
    // the server skip the recipient's push notification.
    const sendFromEditor = useSendFromEditor({ sendMessage, setContent })
    return (
        <>
            <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                    <IconButton radius='full' color='gray' variant='soft' size='2' className='mb-1'>
                        <BiPlus size='20' />
                    </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content className='min-w-48' size='2'>
                    <DropdownMenu.Item onClick={onPollOpen} className='text-base !h-10'>
                        <Flex gap='2' className='items-center'>
                            <MdOutlineBarChart />
                            Poll
                        </Flex>
                    </DropdownMenu.Item>
                    {fileProps && <AttachFile fileProps={fileProps} />}
                    <DropdownMenu.Item onClick={onGIFPickerOpen} className='text-base !h-10'>
                        <Flex gap='2' className='items-center'>
                            <HiOutlineGif />
                            GIF
                        </Flex>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onClick={() => sendFromEditor(true)} className='text-base !h-10'>
                        <Flex gap='2' className='items-center'>
                            <BiBellOff />
                            Send without notification
                        </Flex>
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Root>
            {channelID && <CreatePollDrawer isOpen={isPollOpen} setIsOpen={setIsPollOpen} channelID={channelID} />}
            <AddGIFDrawer isOpen={isGIFPickerOpen} setIsOpen={setIsGIFPickerOpen} />
        </>
    )
}

export default MobileInputActions