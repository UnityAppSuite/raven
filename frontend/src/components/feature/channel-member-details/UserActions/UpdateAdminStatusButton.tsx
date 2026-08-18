import { BiCrown, BiSolidCrown } from 'react-icons/bi'
import { useFrappeUpdateDoc } from 'frappe-react-sdk'
import { toast } from 'sonner'
import { getErrorMessage } from '@/components/layout/AlertBanner/ErrorBanner'
import { Member } from '@/hooks/fetchers/useFetchChannelMembers'

interface UpdateAdminStatusButtonProps {
    user: Member,
    channelID: string,
    updateMembers: () => void
}

export const UpdateAdminStatusButton = ({ user, channelID, updateMembers }: UpdateAdminStatusButtonProps) => {

    const { updateDoc, loading: updatingMember, reset } = useFrappeUpdateDoc()

    // The channel member record name is already available on the member object
    // (fetched via raven.api.chat.get_channel_members). The previous
    // `frappe.client.get_value` lookup was permission-filtered to the current
    // user's OWN membership (raven_channel_member_query), so for any other
    // member it returned an empty name — causing the update to run against an
    // empty document id and fail with "error while updating the document".
    const updateAdminStatus = async (admin: 1 | 0) => {
        return updateDoc('Raven Channel Member', user.channel_member_name ?? '', {
            is_admin: admin
        }).then(() => {
            toast.success('Member has been made an admin')
            updateMembers()
            reset()
        }).catch((e) => {
            toast.error('Failed to update member status', {
                description: getErrorMessage(e)
            })
            reset()
        })
    }

    if (user.is_admin) {
        return <div className={'flex items-center gap-2'}
            onClick={() => updateAdminStatus(0)}>
            <BiCrown />
            {updatingMember ? 'Updating member status...' : 'Dismiss admin'}
        </div>
    } else {
        return <div className={'flex items-center gap-2'}
            onClick={() => updateAdminStatus(1)}>
            <BiSolidCrown />
            {updatingMember ? 'Updating member status...' : 'Make channel admin'}
        </div>
    }
}